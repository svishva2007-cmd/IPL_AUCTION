// ===============================
// IPL AUCTION ARENA - TEAMS.JS
// ===============================

const TEAM_FULL_NAMES = {
    CSK: "Chennai Super Kings", MI: "Mumbai Indians",
    RCB: "Royal Challengers Bengaluru", KKR: "Kolkata Knight Riders",
    DC: "Delhi Capitals", RR: "Rajasthan Royals",
    SRH: "Sunrisers Hyderabad", PBKS: "Punjab Kings",
    LSG: "Lucknow Super Giants", GT: "Gujarat Titans"
};
const TEAM_COLORS = {
    CSK:  { bg: "#f9cd1b", text: "#1a1a1a" }, MI:   { bg: "#004ba0", text: "#fff" },
    RCB:  { bg: "#c41e3a", text: "#fff" },     KKR:  { bg: "#3a225d", text: "#fff" },
    DC:   { bg: "#1a5fa8", text: "#fff" },     RR:   { bg: "#e91e8c", text: "#fff" },
    SRH:  { bg: "#f26522", text: "#fff" },     PBKS: { bg: "#aa1f26", text: "#fff" },
    LSG:  { bg: "#00a0e9", text: "#fff" },     GT:   { bg: "#1c3f6e", text: "#fff" }
};
const INITIAL_PURSE = 125;

// ── Mobile Menu ──────────────────────────────────────────
const menuBtn  = document.querySelector('.menu-btn');
const navLinks = document.querySelector('.nav-links');

menuBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    navLinks.classList.toggle('show-menu');
    menuBtn.setAttribute('aria-expanded', navLinks.classList.contains('show-menu'));
});
document.addEventListener('click', (e) => {
    if (!e.target.closest('.navbar')) {
        navLinks?.classList.remove('show-menu');
        menuBtn?.setAttribute('aria-expanded', 'false');
    }
});
document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', () => navLinks?.classList.remove('show-menu'));
});

// ── SQUAD MODAL INJECTION ────────────────────────────────
(function injectModal() {
    const modal = document.createElement("div");
    modal.id = "squadModalOverlay";
    modal.innerHTML = `
        <div class="sq-modal-box" id="squadBox">
            <div class="sq-modal-header">
                <div class="sq-modal-title">
                    <span class="sq-team-badge" id="sqBadge">CSK</span>
                    <h2 id="sqName">Chennai Super Kings</h2>
                </div>
                <button id="sqClose"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="sq-stats">
                <div class="sq-stat"><div class="sq-stat-val" id="sqPurse">—</div><div class="sq-stat-lbl">PURSE LEFT</div></div>
                <div class="sq-stat"><div class="sq-stat-val" id="sqSpent">—</div><div class="sq-stat-lbl">SPENT</div></div>
                <div class="sq-stat"><div class="sq-stat-val" id="sqCount">0</div><div class="sq-stat-lbl">PLAYERS</div></div>
                <div class="sq-stat"><div class="sq-stat-val" id="sqOverseas">0/8</div><div class="sq-stat-lbl">OVERSEAS</div></div>
            </div>
            <div class="sq-role-row">
                <div class="sq-role-chip bat">🏏 BAT <strong id="sqBat">0</strong></div>
                <div class="sq-role-chip bowl">🏐 BOWL <strong id="sqBowl">0</strong></div>
                <div class="sq-role-chip ar">⭐ AR <strong id="sqAR">0</strong></div>
                <div class="sq-role-chip wk">🧤 WK <strong id="sqWK">0</strong></div>
            </div>
            <div class="sq-table-wrap">
                <table class="sq-table">
                    <thead><tr><th>#</th><th>PLAYER</th><th>ROLE</th><th>PRICE</th></tr></thead>
                    <tbody id="sqBody"></tbody>
                </table>
            </div>
        </div>`;
    modal.style.cssText = `display:none;position:fixed;inset:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(8px);z-index:2000;align-items:center;justify-content:center;padding:20px;`;
    document.body.appendChild(modal);

    document.getElementById("sqClose").addEventListener("click", () => { modal.style.display = "none"; });
    modal.addEventListener("click", e => { if (e.target === modal) modal.style.display = "none"; });
})();

// ── SHOW SQUAD ───────────────────────────────────────────
function showSquad(teamCode) {
    const squads = JSON.parse(localStorage.getItem("iplAuctionSquads") || "{}");
    const purses = JSON.parse(localStorage.getItem("iplAuctionPurses") || "{}");
    const squad  = squads[teamCode] || [];
    const purse  = purses[teamCode] ?? INITIAL_PURSE;
    const spent  = parseFloat((INITIAL_PURSE - purse).toFixed(1));
    const color  = TEAM_COLORS[teamCode];

    let bat = 0, bowl = 0, ar = 0, wk = 0, overseas = 0;
    squad.forEach(p => {
        const r = (p.role || "").toLowerCase();
        if (r.includes("bat") || r.includes("opener"))          bat++;
        else if (r.includes("bowl"))                            bowl++;
        else if (r.includes("all"))                             ar++;
        else if (r.includes("wicket") || r.includes("wk") || r.includes("keeper")) wk++;
        if (p.nationality && p.nationality !== "India")         overseas++;
    });

    document.getElementById("sqBadge").textContent   = teamCode;
    document.getElementById("sqBadge").style.background = color?.bg || "#00c8ff";
    document.getElementById("sqBadge").style.color      = color?.text || "#000";
    document.getElementById("sqName").textContent    = TEAM_FULL_NAMES[teamCode];
    document.getElementById("sqPurse").textContent   = `₹${purse} Cr`;
    document.getElementById("sqSpent").textContent   = `₹${spent} Cr`;
    document.getElementById("sqCount").textContent   = squad.length;
    document.getElementById("sqOverseas").textContent= `${overseas}/8`;
    document.getElementById("sqBat").textContent     = bat;
    document.getElementById("sqBowl").textContent    = bowl;
    document.getElementById("sqAR").textContent      = ar;
    document.getElementById("sqWK").textContent      = wk;

    const tbody = document.getElementById("sqBody");
    tbody.innerHTML = "";
    if (!squad.length) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#a0aec0;padding:20px">No players yet.</td></tr>`;
    } else {
        squad.forEach((p, i) => {
            const tr = document.createElement("tr");
            const isOverseas = p.nationality && p.nationality !== "India";
            tr.innerHTML = `<td style="color:#a0aec0">${i+1}</td>
                <td><strong>${p.name}</strong>${isOverseas ? ' <span style="font-size:0.55rem;background:rgba(240,180,41,0.2);color:#f0b429;padding:1px 6px;border-radius:8px;font-weight:700">OVERSEAS</span>' : ""}</td>
                <td><span style="font-size:0.68rem;background:rgba(0,200,255,0.1);color:#00c8ff;padding:2px 8px;border-radius:10px">${p.role || "—"}</span></td>
                <td style="color:#f0b429;font-weight:700">₹${p.price} Cr</td>`;
            tbody.appendChild(tr);
        });
    }

    const modal = document.getElementById("squadModalOverlay");
    modal.style.display = "flex";
    document.getElementById("squadBox").style.animation = "sqSlideUp 0.25s ease";
}

// ── UPDATE TEAM CARDS ────────────────────────────────────
function updateTeamCards() {
    const squads = JSON.parse(localStorage.getItem("iplAuctionSquads") || "{}");
    const purses = JSON.parse(localStorage.getItem("iplAuctionPurses") || "{}");

    document.querySelectorAll('.team-card').forEach(card => {
        const team  = card.dataset.team?.toUpperCase();
        if (!team) return;
        const squad = squads[team] || [];
        const purse = purses[team] ?? INITIAL_PURSE;
        const vals  = card.querySelectorAll('.info-val');
        if (vals[0]) vals[0].textContent = `₹${purse} Cr`;
        if (vals[1]) vals[1].textContent = squad.length;
        // Overseas count
        const overseas = squad.filter(p => p.nationality && p.nationality !== "India").length;
        if (vals[2]) vals[2].textContent = `${overseas}/8`;
    });
}

// ── CARD BUTTONS ─────────────────────────────────────────
document.querySelectorAll('.team-btn').forEach(button => {
    button.addEventListener('click', () => {
        const teamCode = button.closest('.team-card')?.dataset.team?.toUpperCase();
        if (teamCode) showSquad(teamCode);
    });
});

// ── CARD REVEAL ──────────────────────────────────────────
const cardObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity    = "1";
            entry.target.style.transform  = "translateY(0)";
            cardObserver.unobserve(entry.target);
        }
    });
}, { threshold: 0.1 });

document.querySelectorAll('.team-card').forEach(card => {
    card.style.opacity   = "0";
    card.style.transform = "translateY(30px)";
    card.style.transition= "opacity 0.6s ease, transform 0.6s ease";
    cardObserver.observe(card);
});

// ── INIT ─────────────────────────────────────────────────
updateTeamCards();

// ── INJECT MODAL STYLES ──────────────────────────────────
const style = document.createElement("style");
style.textContent = `
@keyframes sqSlideUp { from { transform: translateY(30px); opacity:0; } to { transform:translateY(0); opacity:1; } }
.sq-modal-box {
    background: #0d1535;
    border: 1px solid rgba(0,200,255,0.3);
    border-radius: 18px;
    width: 100%; max-width: 600px;
    max-height: 88vh;
    display: flex; flex-direction: column;
    box-shadow: 0 0 60px rgba(0,200,255,0.18);
    overflow: hidden;
    animation: sqSlideUp 0.25s ease;
}
.sq-modal-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 18px 22px 14px;
    border-bottom: 1px solid rgba(255,255,255,0.09);
    flex-shrink: 0;
}
.sq-modal-title { display: flex; align-items: center; gap: 12px; }
.sq-modal-title h2 { font-size: 1.1rem; font-weight: 800; color: #fff; }
.sq-team-badge { padding: 4px 14px; border-radius: 20px; font-size: 0.8rem; font-weight: 900; }
#sqClose {
    background: transparent; border: 1px solid rgba(255,255,255,0.09);
    color: #a0aec0; width: 32px; height: 32px;
    border-radius: 8px; cursor: pointer; font-size: 0.9rem;
    transition: 0.2s; display: flex; align-items: center; justify-content: center;
}
#sqClose:hover { color: #00c8ff; border-color: rgba(0,200,255,0.3); }
.sq-stats {
    display: grid; grid-template-columns: repeat(4, 1fr);
    gap: 1px; background: rgba(255,255,255,0.09);
    border-bottom: 1px solid rgba(255,255,255,0.09);
    flex-shrink: 0;
}
.sq-stat { padding: 12px 10px; background: #111a3a; text-align: center; }
.sq-stat-val { font-size: 0.95rem; font-weight: 800; color: #f0b429; }
.sq-stat-lbl { font-size: 0.55rem; color: #a0aec0; letter-spacing: 1px; margin-top: 2px; }
.sq-role-row {
    display: flex; gap: 8px; padding: 10px 18px;
    border-bottom: 1px solid rgba(255,255,255,0.09);
    flex-shrink: 0; flex-wrap: wrap;
}
.sq-role-chip {
    display: flex; align-items: center; gap: 6px;
    padding: 4px 12px; border-radius: 20px;
    font-size: 0.65rem; font-weight: 600;
    border: 1px solid rgba(255,255,255,0.09);
    color: #a0aec0;
}
.sq-role-chip strong { font-size: 0.85rem; font-weight: 800; color: #fff; }
.sq-table-wrap { overflow-y: auto; flex: 1; padding: 10px 18px 18px; }
.sq-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; color: #fff; font-family: 'Poppins', sans-serif; }
.sq-table th { padding: 8px 10px; font-size: 0.58rem; letter-spacing: 1.5px; color: #a0aec0; text-align: left; font-weight: 700; border-bottom: 2px solid rgba(255,255,255,0.09); }
.sq-table td { padding: 9px 10px; border-bottom: 1px solid rgba(255,255,255,0.04); vertical-align: middle; }
.sq-table tbody tr:hover td { background: rgba(0,200,255,0.05); }
`;
document.head.appendChild(style);
