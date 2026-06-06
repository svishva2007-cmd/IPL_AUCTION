// ============================================================
// IPL AUCTION ARENA — multiplayer-auction.js
// Days 1–5: Timer · Sold/Unsold · Next Player · Team Data
//           Host Controls · Live Bidding · Anti-Spam · Purse
// ============================================================

import { db } from "./firebase.js";

import {
    doc,
    onSnapshot,
    updateDoc,
    getDoc
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

// ── ROOM & IDENTITY ─────────────────────────────────────────
const roomCode   = localStorage.getItem("roomCode");
const playerName = localStorage.getItem("playerName");   // set in multiplayer.js at team-select time
const playerTeam = localStorage.getItem("playerTeam");   // the team this player controls

// In singleplayer mode (no roomCode), silently exit — don't redirect
if (!roomCode) {
    console.log("[MP] No room code — running in singleplayer mode, multiplayer module inactive");
} else {

const roomRef = doc(db, "rooms", roomCode);

// ── STATE SHADOW (local mirror of Firestore) ─────────────────
// auction.js owns the DOM; we patch it via window.* and element updates.
let isHost          = false;
let lastBidTime     = 0;          // anti-spam guard
const BID_COOLDOWN  = 600;        // ms between bids per client
let pendingUpdate   = false;      // debounce flag for rapid Firestore writes

// Track whether this player's team is the current highest bidder (for bid-blocking)
let myBidBlocked    = false;

// Shared player order — all clients use this to index players identically
let sharedPlayerOrder = null;     // array of player IDs from Firestore

// ─────────────────────────────────────────────────────────────
// STEP 1 — Identify host and configure UI restrictions
// ─────────────────────────────────────────────────────────────
async function initMultiplayer() {
    const snap = await getDoc(roomRef);
    if (!snap.exists()) {
        alert("Room not found. Returning to lobby.");
        window.location.href = "multiplayer.html";
        return;
    }

    const room = snap.data();
    isHost = (playerName === room.host);

    // Replace the 10-team bid grid with a single BID button for this player's team
    setupSingleBidButton();

    applyHostRestrictions();
    listenToRoom();

    // Always wait for auction.js to finish loading player data
    await waitForPlayers();

    // Apply shared player order from Firestore (may have been missed if snapshot
    // fired before loadPlayers finished — especially for non-host clients)
    if (room.playerOrder && room.playerOrder.length > 0) {
        applySharedPlayerOrder(room.playerOrder);
    }

    // Always cache the players list so hostSellPlayer/hostMarkUnsold can use it
    window.mpPlayers = window.players || window.allPlayers || [];

    if (isHost) {
        // Shuffle players at auction start (only on fresh start, not refresh)
        await shufflePlayersOnStart(room);

        // Re-cache after possible shuffle
        window.mpPlayers = window.players || window.allPlayers || [];

        // Reset the timer in Firestore so the host doesn't read a stale timer: 0
        const timerMax = window.TIMER_MAX_MP || window.TIMER_MAX || 10;
        const currentTimer = room.timer ?? 0;

        // If timer is at 0 or negative, reset it (host is reconnecting after timer expired)
        if (currentTimer <= 0) {
            await safeUpdate({ timer: timerMax });
            window.sharedTimer = timerMax;
        } else {
            window.sharedTimer = currentTimer;
        }

        runHostTimer();
    }

    showToast(
        isHost ? "👑 You are the Host — controls enabled" : `⏳ Bidding as ${playerTeam || "Guest"}`,
        isHost ? "success" : "info"
    );
}

// ─────────────────────────────────────────────────────────────
// SETUP — Single BID button replacing team grid
// ─────────────────────────────────────────────────────────────
function setupSingleBidButton() {
    const bidGrid = document.querySelector(".bid-grid");
    const bidHeader = document.querySelector(".bid-section-header");
    if (!bidGrid) return;

    // Update the header to show the player's team
    if (bidHeader && playerTeam) {
        bidHeader.innerHTML = `<i class="fa-solid fa-hand-pointer"></i> BIDDING AS ${playerTeam} <i class="fa-solid fa-hand-pointer fa-flip-horizontal"></i>`;
    }

    // Replace all 10 team buttons with a single BID button
    bidGrid.innerHTML = "";
    bidGrid.style.display = "flex";
    bidGrid.style.justifyContent = "center";

    const bidBtn = document.createElement("button");
    bidBtn.id = "mpBidBtn";
    bidBtn.className = "bid-btn";
    bidBtn.dataset.team = playerTeam || "";
    bidBtn.style.cssText = `
        min-width: 220px;
        padding: 18px 40px;
        font-size: 1.1rem;
        font-weight: 800;
        letter-spacing: 2px;
        border-radius: 14px;
        cursor: pointer;
        transition: all 0.3s ease;
    `;
    bidBtn.innerHTML = `<span class="btn-abbr" style="font-size:1.1rem;">💰 BID</span>`;

    if (!playerTeam) {
        bidBtn.disabled = true;
        bidBtn.style.opacity = "0.4";
        bidBtn.title = "No team selected — go back to lobby";
    }

    // Attach the bidding logic
    bidBtn.addEventListener("click", async (e) => {
        // Anti-spam cooldown
        const now = Date.now();
        if (now - lastBidTime < BID_COOLDOWN) {
            showToast("⚡ Slow down — too many bids!", "error");
            return;
        }
        lastBidTime = now;

        const team = playerTeam;
        if (!team || window.isPaused || window.auctionEnded) return;

        // Block: can't bid if you're already the highest bidder
        if (myBidBlocked) {
            showToast("⏳ Wait for another team to bid first!", "error");
            return;
        }

        // Validate purse
        const purses   = window.teamPurses || {};
        const BID_INC  = window.BID_INCREMENT_MP || 0.5;
        const nextBid  = parseFloat(((window.currentBid || 0) + BID_INC).toFixed(1));

        if ((purses[team] ?? 125) < nextBid) {
            showToast(`${team} can't afford ₹${nextBid} Cr!`, "error");
            return;
        }

        // Push bid to Firestore (all clients will see it via listener)
        await safeUpdate({
            currentBid:    nextBid,
            highestBidder: team,
            timer:         window.TIMER_MAX_MP || 10   // reset timer on new bid
        });

        // If host, restart their interval
        if (isHost) runHostTimer();
    });

    bidGrid.appendChild(bidBtn);
}

// Update the single bid button state based on current bidder
function updateBidBlockState(currentBidder) {
    myBidBlocked = (currentBidder === playerTeam && currentBidder !== "None");
    const bidBtn = document.getElementById("mpBidBtn");
    if (!bidBtn) return;

    if (myBidBlocked) {
        bidBtn.disabled = true;
        bidBtn.style.opacity = "0.4";
        bidBtn.style.cursor = "not-allowed";
        bidBtn.innerHTML = `<span class="btn-abbr" style="font-size:1.1rem;">⏳ WAITING...</span>`;
    } else {
        // Check affordability
        const purses  = window.teamPurses || {};
        const BID_INC = window.BID_INCREMENT_MP || 0.5;
        const nextBid = parseFloat(((window.currentBid || 0) + BID_INC).toFixed(1));
        const canAfford = (purses[playerTeam] ?? 125) >= nextBid;

        bidBtn.disabled = !canAfford || !playerTeam;
        bidBtn.style.opacity = (canAfford && playerTeam) ? "1" : "0.4";
        bidBtn.style.cursor = (canAfford && playerTeam) ? "pointer" : "not-allowed";
        bidBtn.innerHTML = `<span class="btn-abbr" style="font-size:1.1rem;">💰 BID</span>`;
    }
}

// ─────────────────────────────────────────────────────────────
// SHUFFLE — Random player order at auction start (host only)
// ─────────────────────────────────────────────────────────────
async function shufflePlayersOnStart(room) {
    // Only shuffle if auction just started (player index is 0 and no sold players yet)
    if ((room.currentPlayerIndex || 0) > 0) return;

    // If Firestore already has a playerOrder, don't re-shuffle (another host tab may have done it)
    if (room.playerOrder && room.playerOrder.length > 0) {
        applySharedPlayerOrder(room.playerOrder);
        return;
    }

    const allPlayers = window.allPlayers;
    if (!allPlayers || allPlayers.length === 0) return;

    // Fisher-Yates shuffle
    const shuffled = [...allPlayers];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Save the shuffled order (as player IDs) to Firestore so ALL clients use the same order
    const orderIds = shuffled.map(p => p.id);
    await safeUpdate({ playerOrder: orderIds });

    // Apply locally too
    applySharedPlayerOrder(orderIds);
}

// Apply the shared player order from Firestore to local arrays
function applySharedPlayerOrder(orderIds) {
    if (!orderIds || orderIds.length === 0) return;

    const allPlayers = window.allPlayers;
    if (!allPlayers || allPlayers.length === 0) return;

    // Build a lookup map: id -> player object
    const idMap = {};
    allPlayers.forEach(p => { idMap[p.id] = p; });

    // Rebuild the array in the shared order
    const reordered = orderIds.map(id => idMap[id]).filter(Boolean);

    // Replace the players arrays in auction.js
    window.allPlayers = reordered;
    if (window.players) {
        window.players.length = 0;
        reordered.forEach(p => window.players.push(p));
    }

    sharedPlayerOrder = orderIds;

    console.log("[MP] Applied shared player order. First player:", reordered[0]?.name);

    // Re-display the current player
    if (typeof window.displayPlayer === "function") {
        window.displayPlayer();
    }
}

function waitForPlayers() {
    return new Promise((resolve) => {
        const check = () => {
            if (window.allPlayers && window.allPlayers.length > 0) {
                resolve();
            } else {
                setTimeout(check, 200);
            }
        };
        check();
    });
}

// ─────────────────────────────────────────────────────────────
// STEP 2 — Lock non-host controls (Day 4)
// ─────────────────────────────────────────────────────────────
function applyHostRestrictions() {
    if (isHost) return;   // host keeps all buttons

    const hostOnly = ["pauseBtn", "nextPlayerBtn", "resetBtn", "saveBtn"];
    hostOnly.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.disabled = true;
        el.title    = "Only the host can use this";
        el.style.opacity = "0.4";
        el.style.cursor  = "not-allowed";
    });
}

// Re-apply whenever needed (e.g. after DOM changes)
window.applyHostRestrictions = applyHostRestrictions;

// ─────────────────────────────────────────────────────────────
// STEP 3 — Real-time Firestore listener (Days 1–3)
// ─────────────────────────────────────────────────────────────
function listenToRoom() {
    onSnapshot(roomRef, (snapshot) => {
        const room = snapshot.data();
        if (!room) return;
        console.log(
            "Firebase Player Index:",
            room.currentPlayerIndex
        );

        // Sync the shared player order BEFORE syncing the player index
        // This ensures all clients have the same array before displayPlayer() runs
        syncPlayerOrder(room);

        window.currentPlayerIndex =
            room.currentPlayerIndex || 0;

        if (typeof window.displayPlayer === "function") {
            window.displayPlayer();
        }
        syncTimer(room);
        syncPlayerIndex(room);
        syncBid(room);
        syncHighestBidder(room);
        syncSoldUnsold(room);
        syncTeamData(room);
        syncPauseState(room);
    });
}

// ── 3x. PLAYER ORDER SYNC ───────────────────────────────────
function syncPlayerOrder(room) {
    const order = room.playerOrder;
    if (!order || order.length === 0) return;

    // Only re-apply if order has changed (compare first+last IDs for speed)
    if (sharedPlayerOrder
        && sharedPlayerOrder.length === order.length
        && sharedPlayerOrder[0] === order[0]
        && sharedPlayerOrder[sharedPlayerOrder.length - 1] === order[order.length - 1]) {
        return; // Already applied
    }

    applySharedPlayerOrder(order);
}

// ── 3a. TIMER SYNC (Day 1) ───────────────────────────────────
function syncTimer(room) {
    const t = room.timer ?? 0;
    window.sharedTimer = t;

    const el  = document.getElementById("auctionTimer");
    const bar = document.getElementById("timerBar");
    const TIMER_MAX = window.TIMER_MAX_MP || 10;

    if (el)  el.textContent  = `00 : ${String(Math.max(t, 0)).padStart(2, "0")}`;
    if (bar) {
        bar.style.width = ((Math.max(t, 0) / TIMER_MAX) * 100) + "%";
        bar.classList.toggle("warning", t <= 3);
        el?.classList.toggle("warning", t <= 3);
    }
}

// ── 3b. CURRENT PLAYER SYNC (Day 2) ─────────────────────────
function syncPlayerIndex(room) {
    const newIdx = room.currentPlayerIndex ?? 0;
    if (newIdx !== window.currentPlayerIndex) {
        window.currentPlayerIndex = newIdx;
        if (typeof window.displayPlayer === "function") {
            window.displayPlayer();
        }
    }
}

// ── 3c. BID SYNC (Days 2 & 5) ───────────────────────────────
function syncBid(room) {
    const bid = room.currentBid ?? 0;
    const el  = document.getElementById("currentBid");
    if (el) el.textContent = `₹${bid % 1 === 0 ? bid : bid.toFixed(1)} Cr`;
    window.currentBid = bid;

    // Update bid button affordability
    updateBidBlockState(room.highestBidder || "None");
}

// ── 3d. HIGHEST BIDDER SYNC ──────────────────────────────────
function syncHighestBidder(room) {
    const bidder   = room.highestBidder || "None";
    const el       = document.getElementById("highestBidder");
    const fullEl   = document.getElementById("highestBidderFull");
    const TEAM_FULL_NAMES = window.TEAM_FULL_NAMES_MP || {};

    if (el)     el.textContent     = bidder;
    if (fullEl) fullEl.textContent = bidder !== "None" ? (TEAM_FULL_NAMES[bidder] || "") : "";

    window.highestBidder = bidder;

    // Highlight active bidder row
    document.querySelectorAll(".team-row").forEach(r => r.classList.remove("active-bidder"));
    if (bidder !== "None") {
        document.querySelector(`.team-row[data-team="${bidder}"]`)?.classList.add("active-bidder");
    }

    // Update bid-block state (block current bidder from bidding consecutively)
    updateBidBlockState(bidder);
}

// ── 3e. SOLD / UNSOLD SYNC (Day 2) ──────────────────────────
function syncSoldUnsold(room) {
    const banner = document.getElementById("soldBanner");
    if (!banner) return;

    const status = room.lastPlayerStatus || "";   // "sold:CSK:5.5" | "unsold" | ""
    if (!status) { banner.textContent = ""; banner.className = ""; return; }

    if (status.startsWith("sold:")) {
        const [, team, price] = status.split(":");
        banner.textContent = `🎉 SOLD TO ${team} FOR ₹${price} Cr`;
        banner.style.color = "#00e676";
    } else if (status === "unsold") {
        banner.textContent = `❌ UNSOLD`;
        banner.style.color = "#ff4444";
    }
}

// ── 3f. TEAM DATA SYNC (Day 3) ───────────────────────────────
function syncTeamData(room) {
    const purses = room.teamPurses  || {};
    const squads = room.teamSquads  || {};

    // Patch auction.js globals if they exist
    if (window.teamPurses) Object.assign(window.teamPurses, purses);
    if (window.teamSquads) Object.assign(window.teamSquads, squads);

    // Update DOM purse display
    document.querySelectorAll(".team-row").forEach(row => {
        const team  = row.dataset.team;
        if (!team) return;
        const purse = purses[team] ?? 125;
        const count = (squads[team] || []).length;
        const purseEl = row.querySelector(".team-purse-amt");
        const countEl = row.querySelector(".team-count");
        if (purseEl) purseEl.textContent = `₹${purse} Cr`;
        if (countEl) countEl.textContent  = count;
    });

    // Update total purse display
    const totalPurseEl = document.getElementById("totalPurse");
    if (totalPurseEl) {
        const total = Object.values(purses).reduce((a, v) => a + (v || 0), 0);
        totalPurseEl.textContent = `₹${parseFloat(total.toFixed(1))} Cr`;
    }

    // Also write to localStorage so teams.js and statistics.js stay in sync
    localStorage.setItem("iplAuctionPurses", JSON.stringify(purses));
    localStorage.setItem("iplAuctionSquads", JSON.stringify(squads));

    // Refresh bid button affordability
    updateBidBlockState(window.highestBidder || "None");
}

// ── 3g. PAUSE STATE SYNC (Day 4) ────────────────────────────
function syncPauseState(room) {
    const paused = room.isPaused || false;
    window.isPaused = paused;

    const btn = document.getElementById("pauseBtn");
    if (!btn) return;
    if (paused) {
        btn.innerHTML = '<i class="fa-solid fa-play"></i> Resume';
        btn.style.background = "linear-gradient(135deg,#2196F3,#0d47a1)";
    } else {
        btn.innerHTML = '<i class="fa-solid fa-pause"></i> Pause';
        btn.style.background = "linear-gradient(135deg,#ff9800,#ff5722)";
    }
}

// ─────────────────────────────────────────────────────────────
// STEP 4 — HOST-ONLY TIMER (Day 1 finalised)
// Only the host writes timer ticks to Firestore
// ─────────────────────────────────────────────────────────────
let hostTimerInterval = null;
let processingExpiry = false;

function runHostTimer() {

    clearInterval(hostTimerInterval);

    hostTimerInterval = setInterval(async () => {

        if (window.isPaused || window.auctionEnded) return;

        const t = (window.sharedTimer ?? 0) - 1;

        window.sharedTimer = Math.max(t, 0);

        await safeUpdate({
            timer: Math.max(t, 0)
        });

        if (t <= 0) {

            clearInterval(hostTimerInterval);

            if (processingExpiry) return;

            processingExpiry = true;

            try {

                await handleTimerExpiry();

            } finally {

                setTimeout(() => {

                    processingExpiry = false;

                }, 1000);

            }

        }

    }, 1000);

}

async function handleTimerExpiry() {

    console.log("TIMER EXPIRED");
    console.log("window.highestBidder =", window.highestBidder);
    console.log("window.currentBid =", window.currentBid);

    const bidder = window.highestBidder || "None";

    if (bidder !== "None") {

        console.log("SELLING TO:", bidder);

        await hostSellPlayer(bidder);

    } else {

        console.log("MARKING UNSOLD");

        await hostMarkUnsold();

    }

}

// ─────────────────────────────────────────────────────────────
// STEP 5 — HOST CONTROL ACTIONS (Day 4)
// ─────────────────────────────────────────────────────────────

// Next Player Button (host sells/skips current player)
document.getElementById("nextPlayerBtn")?.addEventListener("click", async () => {
    if (!isHost || window.auctionEnded) return;
    const bidder = window.highestBidder || "None";
    if (bidder !== "None") {
        await hostSellPlayer(bidder);
    } else {
        await hostMarkUnsold();
    }
});

// Pause Button (host only)
document.getElementById("pauseBtn")?.addEventListener("click", async () => {
    if (!isHost) return;
    const newPaused = !(window.isPaused || false);
    window.isPaused = newPaused;
    await safeUpdate({ isPaused: newPaused });
    showToast(newPaused ? "⏸ Auction Paused" : "▶ Auction Resumed", "info");
});

// Sell player on behalf of host
async function hostSellPlayer(team) {

    if (!isHost) return;

    clearInterval(hostTimerInterval);

    const players = window.mpPlayers || [];
    const idx = window.currentPlayerIndex || 0;
    const player = players[idx];

    if (!player) return;

    const price = window.currentBid || player.basePrice;

    const purses = {
        ...(window.teamPurses || {})
    };

    const squads = {
        ...(window.teamSquads || {})
    };

    purses[team] = parseFloat(
        Math.max(
            0,
            (purses[team] || 125) - price
        ).toFixed(1)
    );

    if (!squads[team]) {
        squads[team] = [];
    }

    squads[team].push({
        name: player.name,
        role: player.role,
        price: price,
        nationality: player.nationality || "India"
    });

    const nextIdx = idx + 1;

    await safeUpdate({

        currentPlayerIndex: nextIdx,

        currentBid:
            players[nextIdx]?.basePrice || 2,

        highestBidder: "None",

        timer:
            window.TIMER_MAX_MP || 10,

        isPaused: false,

        lastPlayerStatus:
            `sold:${team}:${price}`,

        teamPurses: purses,

        teamSquads: squads

    });
    console.log("safeUpdate completed");
    console.log("SOLD");
    console.log("Current Index:", idx);
    console.log("Next Index:", nextIdx);
    console.log("Reset Timer:", window.TIMER_MAX_MP || 10);

    showToast(
        `✅ ${player.name} SOLD to ${team} for ₹${price} Cr`,
        "success"
    );

    setTimeout(() => {

        runHostTimer();

    }, 900);

}


// Mark current player unsold
async function hostMarkUnsold() {
    if (!isHost) return;
    clearInterval(hostTimerInterval);

    const players = window.mpPlayers || [];
    const idx     = window.currentPlayerIndex || 0;
    const nextIdx = idx + 1;
    console.log("UNSOLD");
    console.log("Current Index:", idx);
    console.log("Next Index:", nextIdx);
    await safeUpdate({
        currentPlayerIndex: nextIdx,
        currentBid:         players[nextIdx]?.basePrice || 2,
        highestBidder:      "None",
        timer:              window.TIMER_MAX_MP || 10,
        isPaused:           false,
        lastPlayerStatus:   "unsold"
    });

    setTimeout(() => runHostTimer(), 900);
}

// ─────────────────────────────────────────────────────────────
// STEP 7 — Safe Firestore write helper (debounced)
// ─────────────────────────────────────────────────────────────
async function safeUpdate(data) {
    try {
        await updateDoc(roomRef, data);
    } catch (err) {
        console.error("[MP] Firestore write failed:", err);
        showToast("⚠ Sync error — retrying…", "error");
        // Retry once after 1 s
        setTimeout(async () => {
            try { await updateDoc(roomRef, data); } catch (e) { console.error("[MP] Retry failed:", e); }
        }, 1000);
    }
}

// ─────────────────────────────────────────────────────────────
// STEP 8 — Expose TIMER_MAX and BID_INCREMENT to this module
// auction.js sets these on window after loadPlayers(); we read
// them back. Fallback to Firestore room settings.
// ─────────────────────────────────────────────────────────────
(async function resolveSettings() {
    const snap = await getDoc(roomRef);
    const room = snap.data() || {};
    window.TIMER_MAX_MP    = room.timerMax    || window.TIMER_MAX    || 10;
    window.BID_INCREMENT_MP= room.bidIncrement|| window.BID_INCREMENT|| 0.5;
    // Also expose full names for bidder display
    window.TEAM_FULL_NAMES_MP = window.TEAM_FULL_NAMES || {};
})();

// NOTE: Player list caching is handled in initMultiplayer() via waitForPlayers()
// The old monkey-patch of window.loadPlayers was removed because loadPlayers()
// is called by auction.js before this module loads, making the patch ineffective.

// ─────────────────────────────────────────────────────────────
// STEP 10 — Toast utility (mirrors auction.js version)
// ─────────────────────────────────────────────────────────────
function showToast(msg, type = "info") {
    if (typeof window.showToast === "function") { window.showToast(msg, type); return; }
    let container = document.getElementById("toastContainer");
    if (!container) {
        container = document.createElement("div");
        container.id = "toastContainer";
        Object.assign(container.style, {
            position: "fixed", bottom: "24px", right: "24px",
            zIndex: "9999", display: "flex", flexDirection: "column", gap: "8px"
        });
        document.body.appendChild(container);
    }
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    Object.assign(toast.style, {
        background: type === "success" ? "#00e676" : type === "error" ? "#ff4444" : "#00c8ff",
        color: "#000", padding: "10px 18px", borderRadius: "10px",
        fontWeight: "700", fontSize: "0.85rem", opacity: "0",
        transition: "opacity 0.3s", fontFamily: "Poppins, sans-serif"
    });
    container.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = "1"; });
    setTimeout(() => { toast.style.opacity = "0"; setTimeout(() => toast.remove(), 400); }, 3000);
}

// ─────────────────────────────────────────────────────────────
// STEP 11 — HOST: persist team data to Firestore whenever
// auction.js calls persistAll() (wrap it)
// ─────────────────────────────────────────────────────────────
const _origPersistAll = window.persistAll;
window.persistAll = async function (...args) {
    if (typeof _origPersistAll === "function") _origPersistAll(...args);

    if (!isHost) return;   // only host syncs back to Firestore

    // Push latest purses + squads from auction.js globals
    if (window.teamPurses && window.teamSquads) {
        await safeUpdate({
            teamPurses: { ...window.teamPurses },
            teamSquads: { ...window.teamSquads }
        });
    }
};

// ─────────────────────────────────────────────────────────────
// BOOTSTRAP
// ─────────────────────────────────────────────────────────────
initMultiplayer();

} // end of if (roomCode) else block
