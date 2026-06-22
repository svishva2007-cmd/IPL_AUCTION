// auction.js - FIXED VERSION (Timer restarts immediately on unsold/sold)
// =====================================
// IPL AUCTION ARENA — auction.js
// Phases 2.5 → 4 Complete (BUGS FIXED)
// =====================================

const TEAM_FULL_NAMES = {
    CSK:  "Chennai Super Kings",
    MI:   "Mumbai Indians",
    RCB:  "Royal Challengers Bengaluru",
    KKR:  "Kolkata Knight Riders",
    DC:   "Delhi Capitals",
    RR:   "Rajasthan Royals",
    SRH:  "Sunrisers Hyderabad",
    PBKS: "Punjab Kings",
    LSG:  "Lucknow Super Giants",
    GT:   "Gujarat Titans"
};

const TEAM_COLORS = {
    CSK:  { bg: "#f9cd1b", text: "#1a1a1a" },
    MI:   { bg: "#004ba0", text: "#fff" },
    RCB:  { bg: "#c41e3a", text: "#fff" },
    KKR:  { bg: "#3a225d", text: "#fff" },
    DC:   { bg: "#1a5fa8", text: "#fff" },
    RR:   { bg: "#e91e8c", text: "#fff" },
    SRH:  { bg: "#f26522", text: "#fff" },
    PBKS: { bg: "#aa1f26", text: "#fff" },
    LSG:  { bg: "#00a0e9", text: "#fff" },
    GT:   { bg: "#1c3f6e", text: "#fff" }
};

const SETTINGS_KEY    = "iplAuctionSettings";
const STATE_KEY       = "iplAuctionState";
const SQUADS_KEY      = "iplAuctionSquads";
const PURSES_KEY      = "iplAuctionPurses";
const STATS_KEY       = "iplAuctionStats";

let settings = {
    timerMax:      10,
    startPurse:    125,
    bidIncrement:  0.5
};
(function loadSettings() {
    const s = localStorage.getItem(SETTINGS_KEY);
    if (s) settings = { ...settings, ...JSON.parse(s) };
})();

const INITIAL_PURSE = settings.startPurse;
const BID_INCREMENT = settings.bidIncrement;
let   TIMER_MAX     = settings.timerMax;

let players            = [];
let allPlayers         = [];
let currentPlayerIndex = 0;
window.currentPlayerIndex = 0;
let currentBid         = 0;
let highestBidder      = "None";
let soldPlayers        = [];
let unsoldPlayers      = [];
let timer              = TIMER_MAX;
window.sharedTimer = timer;
let timerInterval      = null;
let isPaused           = false;
let searchFilter       = "";
let roleFilter         = "ALL";
let auctionEnded       = false;
let bidCountByTeam     = {};

let teamPurses = {};
let teamSquads = {};
Object.keys(TEAM_FULL_NAMES).forEach(t => {
    teamPurses[t] = INITIAL_PURSE;
    teamSquads[t] = [];
    bidCountByTeam[t] = 0;
});

(function bootstrap() {
    const sq = localStorage.getItem(SQUADS_KEY);
    const pu = localStorage.getItem(PURSES_KEY);
    if (sq) teamSquads = JSON.parse(sq);
    if (pu) teamPurses = JSON.parse(pu);
})();

// ── NAV TOGGLE ──────────────────────────────────────────
const navToggle = document.getElementById("navToggle");
const headerNav = document.getElementById("headerNav");
navToggle?.addEventListener("click", e => {
    e.stopPropagation();
    headerNav.classList.toggle("show");
});
document.addEventListener("click", e => {
    if (!e.target.closest(".header-right")) headerNav?.classList.remove("show");
});

// ── SETTINGS PANEL ──────────────────────────────────────
const settingsBtn   = document.getElementById("settingsBtn");
const settingsPanel = document.getElementById("settingsPanel");
const settingsClose = document.getElementById("settingsClose");
const settingsSave  = document.getElementById("settingsSave");

settingsBtn?.addEventListener("click", () => settingsPanel.classList.add("open"));
settingsClose?.addEventListener("click", () => settingsPanel.classList.remove("open"));

settingsSave?.addEventListener("click", () => {
    const newTimer = parseInt(document.getElementById("setTimer").value) || 10;
    const newPurse = parseFloat(document.getElementById("setPurse").value) || 125;
    const newBid   = parseFloat(document.getElementById("setBid").value) || 0.5;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ timerMax: newTimer, startPurse: newPurse, bidIncrement: newBid }));
    showToast("Settings saved. Reload to apply.", "info");
    settingsPanel.classList.remove("open");
});

document.getElementById("setTimer")?.setAttribute("value", settings.timerMax);
document.getElementById("setPurse")?.setAttribute("value", settings.startPurse);
document.getElementById("setBid")?.setAttribute("value", settings.bidIncrement);

// ── SEARCH & FILTER ─────────────────────────────────────
const searchInput  = document.getElementById("playerSearch");
const roleFilterEl = document.getElementById("roleFilter");

searchInput?.addEventListener("input", () => {
    searchFilter = searchInput.value.toLowerCase();
    renderFilteredList();
});
roleFilterEl?.addEventListener("change", () => {
    roleFilter = roleFilterEl.value;
    renderFilteredList();
});

function renderFilteredList() {
    if (!searchFilter && roleFilter === "ALL") return;
    const panel = document.getElementById("upcomingPlayers");
    if (!panel) return;
    const filtered = players.filter((p, i) => {
        if (i === currentPlayerIndex) return false;
        const nameMatch = p.name.toLowerCase().includes(searchFilter);
        const roleMatch = roleFilter === "ALL" || p.role.toLowerCase().includes(roleFilter.toLowerCase());
        return nameMatch && roleMatch;
    }).slice(0, 6);
    panel.innerHTML = "";
    filtered.forEach((p, i) => {
        const el = document.createElement("div");
        el.className = "upcoming-item";
        el.innerHTML = `<div class="upcoming-num">${i + 1}</div>
            <div><div class="upcoming-name">${p.name}</div><div class="upcoming-role">${p.role}</div></div>`;
        panel.appendChild(el);
    });
}

// ── LOAD PLAYERS ────────────────────────────────────────
async function loadPlayers() {
    try {
        const res = await fetch("players.json");
        if (!res.ok) throw new Error("fetch failed");
        allPlayers = await res.json();
        players = [...allPlayers];

        // In multiplayer, DON'T load local auction state or filter players.
        // The currentPlayerIndex comes from Firestore and indexes into the FULL
        // unfiltered array (same order on all clients via shared playerOrder).
        const isMultiplayer = !!localStorage.getItem("roomCode");
        if (!isMultiplayer) {
            loadAuctionState();
            players = players.filter(p => !soldPlayers.some(s => s.player === p.name) && !unsoldPlayers.includes(p.name));
        }
        // Re-expose after populating so multiplayer module gets the actual data
        window.allPlayers = allPlayers;
        window.players = players;
        if (players.length === 0) { endAuction(); return; }
        displayPlayer();
        // Only start the local timer in singleplayer mode.
        // In multiplayer, the host timer in multiplayer-auction.js handles countdown.
        if (!localStorage.getItem("roomCode")) {
            startTimer();
        }
        updatePurseDisplay();
        updateSquadDisplay();
        updateProgressBar();
    } catch (e) {
        console.error(e);
        showToast("Could not load players.json", "error");
    }
}

// ── DISPLAY PLAYER ──────────────────────────────────────
function displayPlayer() {

    const isMultiplayer = !!localStorage.getItem("roomCode");

    // BugFix #6: Only sync from window.currentPlayerIndex in multiplayer mode
    if (isMultiplayer) {
        currentPlayerIndex = window.currentPlayerIndex ?? 0;
    }

    const player =
        players[currentPlayerIndex];
    if (!player) { endAuction(); return; }

    // BugFix MP-1+4: In multiplayer, bid/bidder come from Firestore via syncBid/syncHighestBidder.
    // Do NOT reset them here — that wipes out live bid data on every snapshot.
    if (!isMultiplayer) {
        currentBid    = player.basePrice;
        highestBidder = "None";
    } else {
        // Read from window globals (set by Firestore sync)
        currentBid    = window.currentBid ?? player.basePrice;
        highestBidder = window.highestBidder || "None";
    }

    document.getElementById("playerName").textContent        = player.name;
    document.getElementById("playerRole").textContent        = player.role;
    document.getElementById("basePrice").textContent         = formatCr(player.basePrice);
    document.getElementById("currentBid").textContent        = formatCr(currentBid);
    document.getElementById("highestBidder").textContent     = highestBidder;
    document.getElementById("highestBidderFull").textContent = highestBidder !== "None" ? (TEAM_FULL_NAMES[highestBidder] || "") : "";
    document.getElementById("playerRating").textContent      = player.overallRating ?? "—";
    document.getElementById("playerMatches").textContent     = player.matches ?? "—";
    document.getElementById("playerRuns").textContent        = player.runs ?? "—";
    document.getElementById("playerWickets").textContent     = player.wickets ?? "—";

    // BugFix MP-7: In multiplayer, don't clear the sold banner here — syncSoldUnsold handles it
    if (!isMultiplayer) {
        document.getElementById("soldBanner").textContent        = "";
        document.getElementById("soldBanner").className          = "";
    }

    const natBadge = document.getElementById("playerNationality");
    if (natBadge) natBadge.textContent = player.nationality || "India";

    document.querySelectorAll(".bid-btn").forEach(b => b.classList.remove("active-bid"));
    document.querySelectorAll(".team-row").forEach(r => r.classList.remove("active-bidder"));
    updateProgressBar();
    displayUpcomingPlayers();
    updateBidButtonsState();
}

function displayUpcomingPlayers() {
    if (searchFilter || roleFilter !== "ALL") { renderFilteredList(); return; }
    const container = document.getElementById("upcomingPlayers");
    if (!container) return;
    container.innerHTML = "";
    for (let i = 1; i <= 5; i++) {
        const idx = currentPlayerIndex + i;
        const p   = players[idx];
        if (!p) continue;
        const el = document.createElement("div");
        el.className = "upcoming-item";
        el.innerHTML = `<div class="upcoming-num">${i}</div>
            <div><div class="upcoming-name">${p.name}</div><div class="upcoming-role">${p.role}</div></div>`;
        container.appendChild(el);
    }
}

// ── BID HISTORY ─────────────────────────────────────────
function addBidHistory(playerName, team, price, timeLabel) {
    const box = document.getElementById("historyBox");
    if (!box) return;
    const entry = document.createElement("div");
    entry.className = "history-entry";
    const badgeStyle = team
        ? `background:${TEAM_COLORS[team]?.bg || "#00c8ff"};color:${TEAM_COLORS[team]?.text || "#000"}`
        : "";
    entry.innerHTML = `
        <div class="history-left">
            <div class="history-player">${playerName}</div>
            <div class="history-time">${timeLabel}</div>
        </div>
        <div class="history-right">
            <div class="history-price">${formatCr(price)}</div>
            ${team ? `<div class="history-team-badge" style="${badgeStyle}">${team}</div>` : ""}
        </div>`;
    box.prepend(entry);
}

// ── TIMER ────────────────────────────────────────────────
function startTimer() {
    clearInterval(timerInterval);
    timer = TIMER_MAX;
    updateTimerDisplay();

    // In multiplayer mode, DON'T run the local countdown — the host timer
    // in multiplayer-auction.js handles countdown + sell/unsold via Firestore.
    if (localStorage.getItem("roomCode")) return;

    timerInterval = setInterval(() => {
        if (isPaused) return;
        timer--;
        updateTimerDisplay();
        if (timer <= 0) {
            clearInterval(timerInterval);
            // Only auto-sell if there's an active bid
            if (highestBidder !== "None") {
                sellPlayer();
            } else {
                // Mark as unsold and immediately move to next player
                const player = players[currentPlayerIndex];
                if (player) {
                    document.getElementById("soldBanner").textContent = `❌ ${player.name} UNSOLD`;
                    document.getElementById("soldBanner").style.color = "#ff4444";
                    if (!unsoldPlayers.includes(player.name)) {
                        unsoldPlayers.push(player.name);
                    }
                    persistAll();
                }
                // IMMEDIATELY advance to next player without delay
                currentPlayerIndex++;
                 persistAll();
                if (currentPlayerIndex >= players.length) {
                    endAuction();
                    return;
                }
                displayPlayer();
                startTimer();
            }
        }
    }, 1000);
}

function updateTimerDisplay() {
    // BugFix #4: Only use window.sharedTimer for display in multiplayer, never overwrite local timer
    const displayVal = localStorage.getItem("roomCode") ? (window.sharedTimer ?? timer) : timer;
    const el  = document.getElementById("auctionTimer");
    const bar = document.getElementById("timerBar");
    const s   = Math.max(displayVal, 0);
    el.textContent = `00 : ${String(s).padStart(2, "0")}`;
    bar.style.width = ((s / TIMER_MAX) * 100) + "%";
    el.classList.toggle("warning", s <= 3);
    bar.classList.toggle("warning", s <= 3);
}

// BugFix #5: Deduplicated — resetTimer was identical to startTimer
function resetTimer() {
    startTimer();
}

// ── SELL PLAYER ──────────────────────────────────────────
function sellPlayer() {
    // In multiplayer, selling is handled by hostSellPlayer() via Firestore
    if (localStorage.getItem("roomCode")) return;
    clearInterval(timerInterval);
    const player = players[currentPlayerIndex];
    if (!player) return;

    const banner = document.getElementById("soldBanner");

    if (highestBidder === "None") {
        banner.textContent = `${player.name} — UNSOLD`;
        banner.style.color = "#ff4444";
        addBidHistory(player.name, null, player.basePrice, "unsold");
        if (!unsoldPlayers.includes(player.name)) {
            unsoldPlayers.push(player.name);
        }
        triggerConfetti(false);
    } else {
        teamSquads[highestBidder].push({ name: player.name, role: player.role, price: currentBid, nationality: player.nationality || "India" });
        banner.textContent = `🎉 ${player.name} SOLD TO ${highestBidder} FOR ${formatCr(currentBid)}`;
        banner.style.color = "#00e676";
        teamPurses[highestBidder] = parseFloat(Math.max(0, teamPurses[highestBidder] - currentBid).toFixed(1));
        soldPlayers.push({ player: player.name, team: highestBidder, price: currentBid });
        bidCountByTeam[highestBidder] = (bidCountByTeam[highestBidder] || 0) + 1;
        // BugFix #8: Add bid history entry for the SOLD outcome
        addBidHistory(player.name, highestBidder, currentBid, "SOLD");
        if (currentBid >= 15) triggerConfetti(true);
        persistAll();
    }

    updatePurseDisplay();
    updateSquadDisplay();
    updateProgressBar();

    // FIXED: Reduced delay to 800ms (shows sold/unsold message briefly, then moves immediately)
    setTimeout(() => {
        currentPlayerIndex++;
        persistAll();
        if (currentPlayerIndex >= players.length) {
            endAuction();
            return;
        }
        displayPlayer();
        startTimer();
    }, 800);
}

// ── NEXT PLAYER (skip/sell) ──────────────────────────────
document.getElementById("nextPlayerBtn").addEventListener("click", () => {
    if (auctionEnded) return;
    // In multiplayer, this is handled by multiplayer-auction.js listener
    if (localStorage.getItem("roomCode")) return;
    sellPlayer();
});

// ── BID BUTTONS (singleplayer only) ──────────────────────
document.querySelectorAll(".bid-btn").forEach(button => {
    button.addEventListener("click", () => {
        // In multiplayer, bidding is handled by multiplayer-auction.js
        if (localStorage.getItem("roomCode")) return;
        const team = button.dataset.team;
        if (isPaused || auctionEnded) return;
        
        // Calculate next bid and check affordability
        const nextBid = parseFloat((currentBid + BID_INCREMENT).toFixed(1));
        if (teamPurses[team] < nextBid) {
            showToast(`${team} can't afford this bid!`, "error");
            return;
        }

        // Allow ANY team to bid (including previous bidder)
        currentBid = nextBid;
        highestBidder = team;
        window.currentBid = currentBid;
        window.highestBidder = highestBidder;
        bidCountByTeam[team] = (bidCountByTeam[team] || 0) + 1;

        document.getElementById("currentBid").textContent        = formatCr(currentBid);
        document.getElementById("highestBidder").textContent     = team;
        document.getElementById("highestBidderFull").textContent = TEAM_FULL_NAMES[team] || "";

        document.querySelectorAll(".bid-btn").forEach(b => b.classList.remove("active-bid"));
        button.classList.add("active-bid");
        
        document.querySelectorAll(".team-row").forEach(r => r.classList.remove("active-bidder"));
        document.querySelector(`.team-row[data-team="${team}"]`)?.classList.add("active-bidder");

        const player = players[currentPlayerIndex];
        addBidHistory(player ? player.name : "—", team, currentBid, new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
        
        // Update button states and reset timer
        updateBidButtonsState();
        resetTimer();
    });
});

// Initialize/Update bid buttons state
function updateBidButtonsState() {
    const nextBid = parseFloat((currentBid + BID_INCREMENT).toFixed(1));
    document.querySelectorAll(".bid-btn").forEach(b => {
        const btnTeam = b.dataset.team;
        const canAfford = teamPurses[btnTeam] >= nextBid;
        b.disabled = !canAfford;
        b.style.opacity = canAfford ? "1" : "0.5";
        b.style.cursor = canAfford ? "pointer" : "not-allowed";
    });
}

// ── PAUSE ────────────────────────────────────────────────
document.getElementById("pauseBtn").addEventListener("click", () => {
    // In multiplayer, pause is handled by multiplayer-auction.js via Firestore
    if (localStorage.getItem("roomCode")) return;
    isPaused = !isPaused;
    const btn = document.getElementById("pauseBtn");
    if (isPaused) {
        btn.innerHTML = '<i class="fa-solid fa-play"></i> Resume';
        btn.style.background = "linear-gradient(135deg,#2196F3,#0d47a1)";
    } else {
        btn.innerHTML = '<i class="fa-solid fa-pause"></i> Pause';
        btn.style.background = "linear-gradient(135deg,#ff9800,#ff5722)";
    }
});

// ── SAVE / LOAD / RESET ──────────────────────────────────
document.getElementById("saveBtn")?.addEventListener("click", () => {
    persistAll();
    showToast("Auction saved!", "success");
});

document.getElementById("resetBtn")?.addEventListener("click", () => {
    if (!confirm("Reset the entire auction? All data will be completely erased.")) return;
    fullAuctionReset();
});

function persistAll() {
    // BugFix #7: Keep window.currentPlayerIndex in sync
    window.currentPlayerIndex = currentPlayerIndex;
    localStorage.setItem(STATE_KEY,  JSON.stringify({ currentPlayerIndex, soldPlayers, unsoldPlayers }));
    localStorage.setItem(SQUADS_KEY, JSON.stringify(teamSquads));
    localStorage.setItem(PURSES_KEY, JSON.stringify(teamPurses));
    localStorage.setItem(STATS_KEY,  JSON.stringify(buildStats()));
}
window.persistAll = persistAll;   // BugFix MP-8: Expose for multiplayer-auction.js monkey-patch

setInterval(() => { if (!auctionEnded) persistAll(); }, 30000);

function loadAuctionState() {
    const s = localStorage.getItem(STATE_KEY);
    if (s) {
        const state = JSON.parse(s);
        currentPlayerIndex = state.currentPlayerIndex || 0;
        soldPlayers        = state.soldPlayers || [];
        unsoldPlayers      = state.unsoldPlayers || [];
    }
}

// ── DISPLAYS ─────────────────────────────────────────────
function updatePurseDisplay() {
    let total = 0;
    document.querySelectorAll(".team-row").forEach(row => {
        const team  = row.dataset.team;
        const purse = teamPurses[team] ?? INITIAL_PURSE;
        const el    = row.querySelector(".team-purse-amt");
        if (el) el.textContent = `₹${purse} Cr`;
        total += purse;
    });
    document.getElementById("totalPurse").textContent = `₹${parseFloat(total.toFixed(1))} Cr`;
}

function updateSquadDisplay() {
    document.querySelectorAll(".team-row").forEach(row => {
        const team = row.dataset.team;
        const el   = row.querySelector(".team-count");
        if (el) el.textContent = teamSquads[team]?.length ?? 0;
    });
}

function updateProgressBar() {
    const total  = allPlayers.length || 1;
    const done = new Set([
        ...soldPlayers.map(p => p.player),
        ...unsoldPlayers
    ]).size;
    const pct    = Math.round((done / total) * 100);
    const bar    = document.getElementById("auctionProgressBar");
    const label  = document.getElementById("auctionProgressLabel");
    if (bar)   bar.style.width = pct + "%";
    if (label) label.textContent = `${done} / ${total} players auctioned (${pct}%)`;
}

// ── STATS BUILDER ────────────────────────────────────────
function buildStats() {
    let totalSpend = 0, highestBid = 0, highestBidPlayer = "—", highestBidTeam = "—";
    let mostActiveBids = 0, mostActiveTeam = "—";

    soldPlayers.forEach(s => {
        totalSpend += s.price;
        if (s.price > highestBid) { highestBid = s.price; highestBidPlayer = s.player; highestBidTeam = s.team; }
    });

    Object.entries(bidCountByTeam).forEach(([team, count]) => {
        if (count > mostActiveBids) { mostActiveBids = count; mostActiveTeam = team; }
    });

    return {
        totalSpend: parseFloat(totalSpend.toFixed(1)),
        highestBid, highestBidPlayer, highestBidTeam,
        sold: soldPlayers.length,
        unsold: unsoldPlayers.length,
        mostActiveTeam, mostActiveBids,
        teamPurses: { ...teamPurses },
        teamSquadSizes: Object.fromEntries(Object.keys(TEAM_FULL_NAMES).map(t => [t, teamSquads[t]?.length || 0]))
    };
}

// ── FORMAT ───────────────────────────────────────────────
function formatCr(val) {
    const n = parseFloat(val);
    return `₹${n % 1 === 0 ? n : n.toFixed(1)} Cr`;
}

// ── TOAST NOTIFICATION ───────────────────────────────────
function showToast(msg, type = "info") {
    let container = document.getElementById("toastContainer");
    if (!container) {
        container = document.createElement("div");
        container.id = "toastContainer";
        document.body.appendChild(container);
    }
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add("show"), 10);
    setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 400); }, 3000);
}

// ── CONFETTI ─────────────────────────────────────────────
function triggerConfetti(big) {
    const count = big ? 120 : 40;
    const colors = ["#00c8ff","#f0b429","#00e676","#ff4444","#a78bfa"];
    for (let i = 0; i < count; i++) {
        const el = document.createElement("div");
        el.className = "confetti-piece";
        el.style.cssText = `
            left:${Math.random()*100}vw;
            background:${colors[Math.floor(Math.random()*colors.length)]};
            width:${Math.random()*8+4}px;
            height:${Math.random()*8+4}px;
            animation-duration:${Math.random()*2+1}s;
            animation-delay:${Math.random()*0.5}s;
        `;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 3500);
    }
}

// ── SQUAD MODAL ──────────────────────────────────────────
const modal        = document.getElementById("squadModal");
const modalClose   = document.getElementById("modalClose");
const modalPrint   = document.getElementById("modalPrint");

modalClose?.addEventListener("click", () => modal.classList.remove("open"));
modal?.addEventListener("click", e => { if (e.target === modal) modal.classList.remove("open"); });

document.querySelectorAll(".team-row").forEach(row => {
    row.addEventListener("dblclick", () => {
        openSquadModal(row.dataset.team);
    });
});

document.querySelector(".view-history-btn")?.addEventListener("click", openHistoryModal);

function openSquadModal(teamCode) {
    const squad  = teamSquads[teamCode] || [];
    const purse  = teamPurses[teamCode] ?? INITIAL_PURSE;
    const spent  = parseFloat((INITIAL_PURSE - purse).toFixed(1));
    const color  = TEAM_COLORS[teamCode];
    const full   = TEAM_FULL_NAMES[teamCode];

    const roles  = { Batsman: 0, Bowler: 0, "All-Rounder": 0, "Wicket Keeper": 0, Other: 0 };
    let overseas = 0;
    squad.forEach(p => {
        const r = p.role || "";
        if (r.includes("Batsman") || r.includes("Batter"))         roles["Batsman"]++;
        else if (r.includes("Bowler"))                             roles["Bowler"]++;
        else if (r.includes("All"))                                roles["All-Rounder"]++;
        else if (r.includes("Wicket") || r.includes("Keeper") || r.includes("WK")) roles["Wicket Keeper"]++;
        else                                                       roles["Other"]++;
        if (p.nationality && p.nationality !== "India")            overseas++;
    });

    const totalRating = squad.length
        ? Math.round(squad.reduce((a, p) => a + (p.overallRating || 75), 0) / squad.length)
        : 0;

    document.getElementById("modalTeamName").textContent  = full;
    document.getElementById("modalTeamCode").textContent  = teamCode;
    document.getElementById("modalTeamCode").style.background = color?.bg || "#00c8ff";
    document.getElementById("modalTeamCode").style.color      = color?.text || "#000";
    document.getElementById("modalPurse").textContent    = formatCr(purse);
    document.getElementById("modalSpent").textContent    = formatCr(spent);
    document.getElementById("modalPlayers").textContent  = squad.length;
    document.getElementById("modalOverseas").textContent = `${overseas}/8`;
    document.getElementById("modalRating").textContent   = totalRating || "—";
    document.getElementById("modalBatters").textContent     = roles["Batsman"];
    document.getElementById("modalBowlers").textContent     = roles["Bowler"];
    document.getElementById("modalAllRounders").textContent = roles["All-Rounder"];
    document.getElementById("modalKeepers").textContent     = roles["Wicket Keeper"];

    const tbody = document.getElementById("modalSquadBody");
    tbody.innerHTML = "";
    if (squad.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-dim);padding:20px">No players purchased yet.</td></tr>`;
    } else {
        squad.forEach((p, i) => {
            const row = document.createElement("tr");
            const isOverseas = p.nationality && p.nationality !== "India";
            row.innerHTML = `
                <td style="color:var(--text-dim);font-size:0.75rem">${i + 1}</td>
                <td><span style="font-weight:700">${p.name}</span>${isOverseas ? ' <span class="overseas-tag">OVERSEAS</span>' : ''}</td>
                <td><span class="role-badge">${p.role || "—"}</span></td>
                <td style="color:var(--accent2);font-weight:700">${formatCr(p.price)}</td>`;
            tbody.appendChild(row);
        });
    }

    modal.classList.add("open");
}

function openHistoryModal() {
    const hist = document.querySelectorAll("#historyBox .history-entry");
    const modal = document.getElementById("squadModal");
    document.getElementById("modalTeamName").textContent = "Full Bid History";
    document.getElementById("modalTeamCode").textContent = "ALL";
    document.getElementById("modalTeamCode").style.background = "#00c8ff";
    document.getElementById("modalTeamCode").style.color = "#000";
    document.getElementById("modalPurse").textContent = "—";
    document.getElementById("modalSpent").textContent = "—";
    document.getElementById("modalPlayers").textContent = hist.length;
    document.getElementById("modalOverseas").textContent = "—";
    document.getElementById("modalRating").textContent = "—";
    ["modalBatters","modalBowlers","modalAllRounders","modalKeepers"].forEach(id => {
        document.getElementById(id).textContent = "—";
    });
    const tbody = document.getElementById("modalSquadBody");
    tbody.innerHTML = "";
    soldPlayers.forEach((s, i) => {
        const color = TEAM_COLORS[s.team];
        const row = document.createElement("tr");
        row.innerHTML = `<td style="color:var(--text-dim)">${i+1}</td>
            <td style="font-weight:700">${s.player}</td>
            <td><span style="background:${color?.bg};color:${color?.text};padding:2px 8px;border-radius:12px;font-size:0.7rem;font-weight:800">${s.team}</span></td>
            <td style="color:var(--accent2);font-weight:700">${formatCr(s.price)}</td>`;
        tbody.appendChild(row);
    });
    if (soldPlayers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-dim);padding:20px">No bids yet.</td></tr>`;
    }
    modal.classList.add("open");
}

modalPrint?.addEventListener("click", () => window.print());

document.querySelector(".purse-list")?.addEventListener("mouseover", () => {
    const hint = document.getElementById("squadHint");
    if (hint) hint.style.opacity = "1";
});

// ── AUCTION END ──────────────────────────────────────────
function endAuction() {
    auctionEnded = true;
    window.auctionEnded = true;   // BugFix MP-10: Expose to multiplayer module
    clearInterval(timerInterval);
    persistAll();

    const stats = buildStats();
    const winner = Object.entries(teamSquads)
        .sort((a, b) => b[1].length - a[1].length)[0];

    const endScreen = document.getElementById("auctionEndScreen");
    if (!endScreen) return;

    const teamRankings = Object.entries(teamSquads)
        .map(([team, squad]) => ({
            team,
            players: squad.length,
            spent: parseFloat((INITIAL_PURSE - (teamPurses[team] || 0)).toFixed(1)),
            avgPrice: squad.length ? parseFloat((squad.reduce((a, p) => a + p.price, 0) / squad.length).toFixed(1)) : 0
        }))
        .sort((a, b) => b.players - a.players || a.spent - b.spent);

    endScreen.innerHTML = `
        <div class="end-overlay">
            <div class="end-box">
                <div class="end-fireworks">🎉</div>
                <h2 class="end-title">AUCTION COMPLETE!</h2>
                <div class="end-stats-grid">
                    <div class="end-stat"><div class="end-stat-val">${stats.sold}</div><div class="end-stat-label">Players Sold</div></div>
                    <div class="end-stat"><div class="end-stat-val">${stats.unsold}</div><div class="end-stat-label">Unsold</div></div>
                    <div class="end-stat"><div class="end-stat-val">${formatCr(stats.totalSpend)}</div><div class="end-stat-label">Total Spent</div></div>
                    <div class="end-stat"><div class="end-stat-val">${formatCr(stats.highestBid)}</div><div class="end-stat-label">Highest Bid</div></div>
                </div>
                <div class="end-winner">
                    <div class="end-winner-label">🏆 MOST PLAYERS BOUGHT</div>
                    <div class="end-winner-team" style="background:${TEAM_COLORS[winner[0]]?.bg};color:${TEAM_COLORS[winner[0]]?.text}">${winner[0]}</div>
                    <div class="end-winner-full">${TEAM_FULL_NAMES[winner[0]]}</div>
                </div>
                <div class="end-rankings">
                    <div class="end-rank-header"><span>TEAM</span><span>PLAYERS</span><span>SPENT</span><span>AVG PRICE</span></div>
                    ${teamRankings.map((r, i) => `
                    <div class="end-rank-row">
                        <span><strong>#${i+1}</strong> <span class="mini-badge" style="background:${TEAM_COLORS[r.team]?.bg};color:${TEAM_COLORS[r.team]?.text}">${r.team}</span></span>
                        <span>${r.players}</span>
                        <span>${formatCr(r.spent)}</span>
                        <span>${r.avgPrice ? formatCr(r.avgPrice) : "—"}</span>
                    </div>`).join("")}
                </div>
                <div class="end-actions">
                    <button onclick="window.location.href='statistics.html'" class="end-btn-primary"><i class="fa-solid fa-chart-line"></i> View Statistics</button>
                    <button onclick="window.location.href='teams.html'" class="end-btn-secondary"><i class="fa-solid fa-users"></i> View Teams</button>
                    <button onclick="resetAuctionFull()" class="end-btn-danger"><i class="fa-solid fa-rotate"></i> New Auction</button>
                </div>
            </div>
        </div>`;
    endScreen.style.display = "flex";
    triggerConfetti(true);
    setTimeout(() => triggerConfetti(true), 600);
}

function fullAuctionReset() {
    // 1. Stop all timers
    clearInterval(timerInterval);

    // 2. Clear ALL localStorage keys related to the auction
    [STATE_KEY, SQUADS_KEY, PURSES_KEY, STATS_KEY, SETTINGS_KEY].forEach(k => localStorage.removeItem(k));
    // Also clear multiplayer-related keys
    localStorage.removeItem("roomCode");
    localStorage.removeItem("playerTeam");
    localStorage.removeItem("playerName");
    // Clear any bid history stored in localStorage
    localStorage.removeItem("iplAuctionBidHistory");

    // 3. Reset all in-memory state
    currentPlayerIndex = 0;
    currentBid = 0;
    highestBidder = "None";
    soldPlayers = [];
    unsoldPlayers = [];
    timer = TIMER_MAX;
    isPaused = false;
    auctionEnded = false;
    bidCountByTeam = {};

    // 4. Reset team purses and squads to defaults
    Object.keys(TEAM_FULL_NAMES).forEach(t => {
        teamPurses[t] = INITIAL_PURSE;
        teamSquads[t] = [];
        bidCountByTeam[t] = 0;
    });

    // 5. Reset window globals
    window.currentPlayerIndex = 0;
    window.sharedTimer = TIMER_MAX;
    window.currentBid = 0;
    window.highestBidder = "None";
    window.isPaused = false;
    window.auctionEnded = false;

    // 6. Reload the page to start fresh
    location.reload();
}

function resetAuctionFull() {
    if (!confirm("Start a brand-new auction? All data will be cleared.")) return;
    fullAuctionReset();
}
window.resetAuctionFull = resetAuctionFull;
window.displayPlayer = displayPlayer;
// BugFix #3: Expose functions that multiplayer-auction.js depends on
window.showToast = showToast;
window.startTimer = startTimer;
window.resetTimer = resetTimer;
window.sellPlayer = sellPlayer;
window.updateBidButtonsState = updateBidButtonsState;
// Expose data arrays and objects for multiplayer module
window.allPlayers = allPlayers;
window.players = players;
window.teamPurses = teamPurses;
window.teamSquads = teamSquads;
window.TEAM_FULL_NAMES = TEAM_FULL_NAMES;
window.TIMER_MAX = TIMER_MAX;
window.BID_INCREMENT = BID_INCREMENT;
window.getAuctionState = () => ({
    currentPlayerIndex,
    currentBid,
    highestBidder
});
// ── INIT ─────────────────────────────────────────────────
loadPlayers();
