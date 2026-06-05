import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";

import {
    getFirestore
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAoRCgGX1tQhPcvCY9j0QOsofFrsRTcSOc",
    authDomain: "ipl-auction-arena-1ea6f.firebaseapp.com",
    projectId: "ipl-auction-arena-1ea6f",
    storageBucket: "ipl-auction-arena-1ea6f.firebasestorage.app",
    messagingSenderId: "457681663274",
    appId: "1:457681663274:web:f1d7dce7fd8485c1e49a53",
    measurementId: "G-X5904DL96C"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);