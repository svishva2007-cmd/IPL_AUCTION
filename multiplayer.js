import { db } from "./firebase.js";

import {
    doc,
    setDoc,
    getDoc,
    updateDoc,
    arrayUnion,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
let currentRoomCode = "";
let currentHost = "";
// Generate Room Code
function generateRoomCode() {
    return "IPL" + Math.floor(1000 + Math.random() * 9000);
}

// =========================
// CREATE ROOM
// =========================
document
.getElementById("createRoomBtn")
.addEventListener("click", async () => {

    const playerName =
        document
        .getElementById("playerName")
        .value
        .trim();

    if (!playerName) {
        alert("Enter Your Name");
        return;
    }

    const roomCode = generateRoomCode();

    // Fresh team purses
    const defaultPurses = {
        CSK: 125,
        MI: 125,
        RCB: 125,
        KKR: 125,
        DC: 125,
        RR: 125,
        SRH: 125,
        PBKS: 125,
        LSG: 125,
        GT: 125
    };

    // Fresh empty squads
    const defaultSquads = {
        CSK: [],
        MI: [],
        RCB: [],
        KKR: [],
        DC: [],
        RR: [],
        SRH: [],
        PBKS: [],
        LSG: [],
        GT: []
    };

    // Clear old multiplayer data
    localStorage.removeItem("roomCode");
    localStorage.removeItem("playerTeam");
    localStorage.removeItem("playerName");

    await setDoc(
        doc(db, "rooms", roomCode),
        {
            host: playerName,

            players: [playerName],

            teams: {},

            auctionStarted: false,

            currentPlayerIndex: 0,
            currentPlayer: "MS Dhoni",

            currentBid: 2,
            highestBidder: "None",

            timer: 10,

            soldPlayers: [],
            unsoldPlayers: [],

            teamPurses: defaultPurses,
            teamSquads: defaultSquads
        }
    );

    currentRoomCode = roomCode;
    currentHost = playerName;

    document.getElementById("roomDisplay").textContent =
        `Room Created: ${roomCode}`;

    listenForPlayers(roomCode);
    listenForTeams(roomCode);
    updateHostDashboard();
    listenForAuctionStart(roomCode);

});

// =========================
// JOIN ROOM
// =========================
document
.getElementById("joinRoomBtn")
.addEventListener("click", async () => {

    const roomCode =
        document
        .getElementById("roomCodeInput")
        .value
        .trim()
        .toUpperCase();

    const playerName =
        document
        .getElementById("playerName")
        .value
        .trim();

    if (!playerName) {
        alert("Enter Your Name");
        return;
    }

    if (!roomCode) {
        alert("Enter Room Code");
        return;
    }

    const roomRef = doc(db, "rooms", roomCode);

    const roomSnap = await getDoc(roomRef);

    // BugFix #9: Check exists() BEFORE accessing .data() to prevent TypeError
    if (!roomSnap.exists()) {
        alert("Room Not Found!");
        return;
    }

    const roomData = roomSnap.data();
    currentHost = roomData.host;

    await updateDoc(roomRef, {
        players: arrayUnion(playerName)
    });

    currentRoomCode = roomCode;

    document.getElementById("roomDisplay").textContent =
        `Joined Room: ${roomCode}`;

    listenForPlayers(roomCode);
    listenForTeams(roomCode);
    updateHostDashboard();
    listenForAuctionStart(roomCode);
});

// =========================
// LIVE PLAYERS LIST
// =========================
function listenForPlayers(roomCode) {

    const roomRef =
        doc(db, "rooms", roomCode);

    onSnapshot(roomRef, (snapshot) => {

        const data = snapshot.data();

        if (!data) return;

        const players = data.players || [];

        const list =
            document.getElementById("playersList");

        list.innerHTML = "";

        players.forEach(player => {

            const li =
                document.createElement("li");

            li.textContent = player;

            list.appendChild(li);

        });

    });

}
function listenForTeams(roomCode) {

    const roomRef =
        doc(db, "rooms", roomCode);

    onSnapshot(roomRef, (snapshot) => {

        const data = snapshot.data();

        if (!data) return;

        const teams =
            data.teams || {};

        const list =
            document.getElementById("teamsList");

        list.innerHTML = "";

        Object.entries(teams)
            .forEach(([team, owner]) => {

                const li =
                    document.createElement("li");

                li.textContent =
                    `${team} → ${owner}`;

                list.appendChild(li);

            });

    });

}
// =========================
// TEAM SELECTION
// =========================

document
.getElementById("selectTeamBtn")
.addEventListener("click", async () => {

    const selectedTeam =
        document
        .getElementById("teamSelect")
        .value;

    const playerName =
        document
        .getElementById("playerName")
        .value
        .trim();

    if (!selectedTeam) {
        alert("Select a Team");
        return;
    }

    if (!currentRoomCode) {
        alert("Join or Create a Room First");
        return;
    }

    const roomRef =
        doc(db, "rooms", currentRoomCode);

    const roomSnap =
        await getDoc(roomRef);

    const data =
        roomSnap.data();

    const teams =
        data.teams || {};

    if (teams[selectedTeam]) {

        alert(
            `${selectedTeam} is already taken`
        );

        return;

    }

    await updateDoc(roomRef, {
        [`teams.${selectedTeam}`]:
            playerName
    });

    // Store selected team in localStorage so multiplayer-auction.js knows which team this player bids for
    localStorage.setItem("playerTeam", selectedTeam);

});
function updateHostDashboard() {

    const playerName =
        document
        .getElementById("playerName")
        .value
        .trim();

    const hostStatus =
        document
        .getElementById("hostStatus");

    const startBtn =
        document
        .getElementById("startAuctionBtn");

    // BugFix #10: Only set isHost when playerName is non-empty and matches currentHost
    if (playerName !== "" && playerName === currentHost) {

        hostStatus.textContent =
            "👑 You are the Host";

        startBtn.style.display =
            "inline-block";

    } else {

        hostStatus.textContent =
            "⏳ Waiting For Host To Start Auction";

        startBtn.style.display =
            "none";

    }

}
// =========================
// START AUCTION
// =========================

document
.getElementById("startAuctionBtn")
.addEventListener("click", async () => {

    if (!currentRoomCode) return;

    const roomRef =
        doc(db, "rooms", currentRoomCode);

    await updateDoc(roomRef, {

    auctionStarted: true,

    currentPlayerIndex: 0,
    currentBid: 2,
    highestBidder: "None",
    timer: 10

});

});
function listenForAuctionStart(roomCode) {

    const roomRef =
        doc(db, "rooms", roomCode);

    onSnapshot(roomRef, (snapshot) => {

        const data =
            snapshot.data();

        if (!data) return;
        console.log(
            "Snapshot:",
            data.currentPlayerIndex,
            data.timer
        );

        if (data.auctionStarted) {

            localStorage.setItem(
                "roomCode",
                roomCode
            );

            // Save player identity so multiplayer-auction.js can
            // detect the host and restrict non-host controls.
            const pName =
                document
                .getElementById("playerName")
                .value
                .trim();

            if (pName) {
                localStorage.setItem("playerName", pName);
            }

            window.location.href =
                "auction.html";

        }

    });

}