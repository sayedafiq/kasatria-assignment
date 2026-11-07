import * as THREE from 'three';
import TWEEN from 'three/addons/libs/tween.module.js';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';

// KREDENSIAL GOOGLE CLOUD & SPREADSHEET
const CLIENT_ID = '494442733700-b3mmlmha2qe0o1snig3dj83jogcm1nel.apps.googleusercontent.com';
const SPREADSHEET_ID = '1iWz3SsYdAZ9dx8dV4FGUPBDuPe_yjlj-ZrOAT1fVBsk';
const TARGET_GID = '737744905'; // GID helaian daripada URL anda

const FALLBACK_AVATAR =
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><rect width='100' height='100' fill='%23202a38'/><circle cx='50' cy='38' r='18' fill='%238aa4b8'/><path d='M20 88c4-18 18-28 30-28s26 10 30 28' fill='%238aa4b8'/></svg>";

let camera, scene, renderer, controls;
let tokenClient = null;
const objects = [];
const targets = { table: [], sphere: [], helix: [], grid: [] };

// 1. Inisialisasi Google Identity Services OAuth 2.0
window.addEventListener('DOMContentLoaded', () => {
    const loginButton = document.getElementById('btn-login');

    loginButton.addEventListener('click', () => {
        // Semak jika CLIENT_ID masih belum ditetapkan oleh pengguna
        if (
            !CLIENT_ID ||
            CLIENT_ID.includes('MASUKKAN_GOOGLE_CLIENT_ID_ANDA') ||
            !SPREADSHEET_ID ||
            SPREADSHEET_ID.includes('MASUKKAN_SPREADSHEET_ID_ANDA')
        ) {
            const useDemo = confirm(
                'CLIENT_ID atau SPREADSHEET_ID belum dimasukkan di dalam app.js.\n\n' +
                'Klik OK untuk melihat pratonton (Demo 200 data) terlebih dahulu, atau Cancel untuk menetapkan kredensial anda.'
            );
            if (useDemo) {
                document.getElementById('login-screen').style.display = 'none';
                document.getElementById('app-view').style.display = 'block';
                const demoItems = generateDemoData(200);
                initScene(demoItems);
                animate();
            }
            return;
        }

        if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
            alert('SDK Google Identity Services sedang dimuatkan. Sila cuba sebentar lagi.');
            return;
        }

        if (!tokenClient) {
            tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: CLIENT_ID,
                scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
                error_callback: (nonOAuthError) => {
                    console.error('GIS Non-OAuth Error:', nonOAuthError);
                    alert(`Ralat Google GIS: ${nonOAuthError?.message || nonOAuthError?.type || 'Sila semak tetapan pelayar / popup.'}`);
                },
                callback: async (tokenResponse) => {
                    console.log('Google OAuth Response:', tokenResponse);

                    if (tokenResponse.error) {
                        console.error('OAuth Token Error:', tokenResponse);
                        alert(`Log masuk dibatalkan atau disekat: ${tokenResponse.error}\n(${tokenResponse.error_description || 'Kebenaran tidak diberikan.'})`);
                        return;
                    }

                    if (tokenResponse && tokenResponse.access_token) {
                        document.getElementById('login-screen').style.display = 'none';
                        document.getElementById('app-view').style.display = 'block';
                        const container = document.getElementById('container');
                        container.innerHTML = `
                          <div id="loading-msg" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:16px;color:#00ffff;letter-spacing:1px;text-align:center;">
                            <div style="font-size:36px;margin-bottom:12px;animation:spin 1s infinite linear;">⏳</div>
                            <div>Memuat turun data daripada Google Sheet anda...</div>
                          </div>
                        `;
                        await fetchGoogleSheetData(tokenResponse.access_token);
                    } else {
                        alert('Tiada token akses diterima daripada Google. Sila pastikan anda menandakan kotak kebenaran membaca Google Sheet.');
                    }
                },
            });
        }

        tokenClient.requestAccessToken({ prompt: '' });
    });
});

// 2. Mengambil Rekod daripada Google Sheets API Secara Automatik
async function fetchGoogleSheetData(accessToken) {
    try {
        // A. Ambil metadata spreadsheet untuk ketahui nama sebenar helaian (sheet tab)
        const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?includeGridData=false`;
        const metaRes = await fetch(metaUrl, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (!metaRes.ok) {
            const errBody = await metaRes.json().catch(() => ({}));
            throw new Error(errBody?.error?.message || `HTTP ${metaRes.status} (Gagal membaca helaian)`);
        }

        const metaData = await metaRes.json();
        const sheets = metaData.sheets || [];

        if (sheets.length === 0) {
            throw new Error('Spreadsheet ini tidak mengandungi sebarang helaian.');
        }

        // Cari helaian yang sepadan dengan GID atau helaian yang ada data
        let targetSheet = sheets.find((s) => String(s.properties?.sheetId) === String(TARGET_GID));
        if (!targetSheet) {
            // Jika GID tiada, pilih helaian yang mempunyai bilangan baris terbanyak
            targetSheet = sheets.reduce((prev, curr) => {
                const prevRows = prev?.properties?.gridProperties?.rowCount || 0;
                const currRows = curr?.properties?.gridProperties?.rowCount || 0;
                return currRows > prevRows ? curr : prev;
            }, sheets[0]);
        }

        const sheetTitle = targetSheet?.properties?.title || sheets[0].properties?.title || 'Sheet1';
        console.log('Memuatkan data daripada helaian:', sheetTitle, 'GID:', targetSheet?.properties?.sheetId);

        // B. Ambil data baris daripada helaian yang dikenal pasti
        const dataUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/'${encodeURIComponent(sheetTitle)}'!A1:Z500`;
        const dataRes = await fetch(dataUrl, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (!dataRes.ok) {
            const errBody = await dataRes.json().catch(() => ({}));
            throw new Error(errBody?.error?.message || `HTTP ${dataRes.status}`);
        }

        const sheetValues = await dataRes.json();
        const rows = sheetValues.values || [];

        if (rows.length <= 1) {
            throw new Error(`Helaian "${sheetTitle}" tidak mempunyai data baris rekod.`);
        }

        // C. Kesan susunan lajur mengikut nama header secara dinamik
        const headerRow = (rows[0] || []).map((h) => String(h || '').trim().toLowerCase());

        const nameIdx = headerRow.findIndex((h) => h.includes('name') || h.includes('nama'));
        const photoIdx = headerRow.findIndex((h) => h.includes('photo') || h.includes('image') || h.includes('pic') || h.includes('avatar') || h.includes('url') || h.includes('gambar'));
        const ageIdx = headerRow.findIndex((h) => h.includes('age') || h.includes('umur'));
        const countryIdx = headerRow.findIndex((h) => h.includes('country') || h.includes('negara') || h.includes('nat'));
        const interestIdx = headerRow.findIndex((h) => h.includes('interest') || h.includes('minat') || h.includes('hobby'));
        const netWorthIdx = headerRow.findIndex((h) => h.includes('net') || h.includes('worth') || h.includes('nilai'));

        const colName = nameIdx !== -1 ? nameIdx : 0;
        const colPhoto = photoIdx !== -1 ? photoIdx : 1;
        const colAge = ageIdx !== -1 ? ageIdx : 2;
        const colCountry = countryIdx !== -1 ? countryIdx : 3;
        const colInterest = interestIdx !== -1 ? interestIdx : 4;
        const colNetWorth = netWorthIdx !== -1 ? netWorthIdx : 5;

        // D. Ekstrak dan bersihkan data
        const items = rows
            .slice(1)
            .filter((col) => col && col.length > 0 && col.some((c) => String(c).trim() !== ''))
            .map((col, idx) => {
                const rawNet = col[colNetWorth] || '$0';
                const cleanNum = parseFloat(String(rawNet).replace(/[^0-9.-]+/g, '')) || 0;
                return {
                    name: col[colName] || `Person #${idx + 1}`,
                    photo: col[colPhoto] || FALLBACK_AVATAR,
                    age: col[colAge] || '-',
                    country: col[colCountry] || '-',
                    interest: col[colInterest] || '-',
                    netWorthRaw: String(rawNet).trim() || `$${cleanNum.toLocaleString()}`,
                    netWorth: cleanNum
                };
            });

        console.log(`Berjaya membaca ${items.length} rekod daripada Google Sheet! Contoh:`, items[0]);

        if (items.length === 0) {
            alert('Tiada data rekod dijumpai di dalam helaian ini. Sila semak fail Google Sheet anda.');
            return;
        }

        initScene(items);
        animate();
    } catch (err) {
        console.error('Ralat semasa mengambil data Google Sheet:', err);
        alert(`Gagal membaca data dari Google Sheet: ${err.message}\nSila semak semula kebenaran perkongsian Google Sheet anda.`);
    }
}

// 3. Membina Objek CSS3D
function initScene(dataList) {
    camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 1, 10000);
    camera.position.z = 3000;

    scene = new THREE.Scene();

    dataList.forEach((item) => {
        const el = document.createElement('div');
        el.className = 'element';

        // Penetapan Kategori Warna Mengikut Nilai Bersih (Red <$100K, Orange $100K-$200K, Green >$200K)
        if (item.netWorth > 200000) {
            el.classList.add('tier-green');   // > $200K
        } else if (item.netWorth >= 100000) {
            el.classList.add('tier-orange');  // $100K - $200K
        } else {
            el.classList.add('tier-red');     // < $100K
        }

        // Struktur Data Seperti Image B
        el.innerHTML = `
      <div class="tile-header">
        <span class="country" title="${item.country}">${item.country}</span>
        <span class="age">${item.age}</span>
      </div>
      <div class="avatar-wrap">
        <img src="${item.photo}" alt="${item.name}" loading="lazy" onerror="this.onerror=null;this.src='${FALLBACK_AVATAR}';" />
      </div>
      <div class="details">
        <div class="name" title="${item.name}">${item.name}</div>
        <div class="interest" title="${item.interest}">${item.interest}</div>
      </div>
    `;

        const objectCSS = new CSS3DObject(el);
        objectCSS.position.x = Math.random() * 4000 - 2000;
        objectCSS.position.y = Math.random() * 4000 - 2000;
        objectCSS.position.z = Math.random() * 4000 - 2000;
        scene.add(objectCSS);
        objects.push(objectCSS);
    });

    generateLayoutTargets(dataList.length);

    renderer = new CSS3DRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    const container = document.getElementById('container');
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    controls = new TrackballControls(camera, renderer.domElement);
    controls.rotateSpeed = 1.0;
    controls.zoomSpeed = 1.2;
    controls.panSpeed = 0.8;
    controls.noZoom = false;
    controls.noPan = false;
    controls.staticMoving = false;
    controls.dynamicDampingFactor = 0.3;
    controls.minDistance = 300;
    controls.maxDistance = 6000;
    controls.addEventListener('change', render);

    // Sambungkan Fungsi Butang Pilihan Menu
    const buttons = {
        table: document.getElementById('table'),
        sphere: document.getElementById('sphere'),
        helix: document.getElementById('helix'),
        grid: document.getElementById('grid')
    };

    Object.entries(buttons).forEach(([key, btn]) => {
        btn.addEventListener('click', () => {
            Object.values(buttons).forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            transform(targets[key], 2000);
        });
    });

    transform(targets.table, 2000);
    window.addEventListener('resize', onWindowResize);
}

// 4. Pengiraan Koordinat bagi Keempat-empat Susun Atur
function generateLayoutTargets(count) {
    const vector = new THREE.Vector3();

    // (A) Table: 20 Lajur x 10 Baris
    const cols = 20;
    for (let i = 0; i < count; i++) {
        const object = new THREE.Object3D();
        const col = i % cols;
        const row = Math.floor(i / cols);

        object.position.x = (col * 165) - ((cols - 1) * 165) / 2;
        object.position.y = -(row * 205) + 920;
        object.position.z = 0;
        targets.table.push(object);
    }

    // (B) Sphere: Sfera Fibonacci
    for (let i = 0; i < count; i++) {
        const phi = Math.acos(-1 + (2 * i) / count);
        const theta = Math.sqrt(count * Math.PI) * phi;
        const object = new THREE.Object3D();

        object.position.setFromSphericalCoords(850, phi, theta);
        vector.copy(object.position).multiplyScalar(2);
        object.lookAt(vector);
        targets.sphere.push(object);
    }

    // (C) Double Helix: Dua Bebenang Pilin (Strand A & B)
    const helixRadius = 900;
    for (let i = 0; i < count; i++) {
        const strand = i % 2; // Strand 0 atau Strand 1
        const step = Math.floor(i / 2);
        const theta = step * 0.175 + (strand * Math.PI); // Fasa berbeza 180 darjah (Double Helix)
        const y = -(step * 18) + 880;

        const object = new THREE.Object3D();
        object.position.x = helixRadius * Math.sin(theta);
        object.position.y = y;
        object.position.z = helixRadius * Math.cos(theta);

        vector.x = object.position.x * 2;
        vector.y = object.position.y;
        vector.z = object.position.z * 2;
        object.lookAt(vector);

        targets.helix.push(object);
    }

    // (D) Grid: Dimensi 10 x 4 x 5 (X:10, Y:4, Z:5) - Rujuk Image C
    const gx = 10, gy = 4, gz = 5;
    const dx = 200, dy = 240, dz = 400;
    for (let i = 0; i < count; i++) {
        const object = new THREE.Object3D();
        const x = i % gx;
        const y = Math.floor(i / gx) % gy;
        const z = Math.floor(i / (gx * gy));

        object.position.x = (x * dx) - ((gx - 1) * dx) / 2;
        object.position.y = -(y * dy) + ((gy - 1) * dy) / 2;
        object.position.z = (z * dz) - ((gz - 1) * dz) / 2;
        targets.grid.push(object);
    }
}

// 5. Animasi Peralihan Menggunakan Tween.js
function transform(targetsArray, duration) {
    TWEEN.removeAll();

    for (let i = 0; i < objects.length; i++) {
        const object = objects[i];
        const target = targetsArray[i];

        new TWEEN.Tween(object.position)
            .to({ x: target.position.x, y: target.position.y, z: target.position.z }, Math.random() * duration + duration)
            .easing(TWEEN.Easing.Exponential.InOut)
            .start();

        new TWEEN.Tween(object.rotation)
            .to({ x: target.rotation.x, y: target.rotation.y, z: target.rotation.z }, Math.random() * duration + duration)
            .easing(TWEEN.Easing.Exponential.InOut)
            .start();
    }

    // Gunakan objek kosong {} kerana 'this' adalah undefined di dalam ES Module
    new TWEEN.Tween({})
        .to({}, duration * 2)
        .onUpdate(render)
        .start();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    render();
}

function animate() {
    requestAnimationFrame(animate);
    TWEEN.update();
    controls.update();
    render();
}

function render() {
    renderer.render(scene, camera);
}

// Data Pratonton (Demo) jika CLIENT_ID / SPREADSHEET_ID belum dikonfigurasi
function generateDemoData(count) {
    const countries = ['MY', 'SG', 'US', 'UK', 'JP', 'AU', 'DE', 'CA', 'FR', 'KR'];
    const interests = ['Writing', 'Traveling', 'Painting', 'Cooking', 'Photography', 'Coding', 'Gaming', 'Music', 'Reading', 'Fitness'];
    const names = ['Aiman Hakim', 'Sarah Tan', 'Daniel Lim', 'Nurul Izzah', 'Jason Wong', 'Amirah Zain', 'Kevin Raj', 'Mei Ling', 'Farid Kamil', 'Chloe Ng'];

    return Array.from({ length: count }, (_, i) => {
        const netWorth = Math.floor(Math.random() * 280000) + 30000;
        return {
            name: `${names[i % names.length]} #${i + 1}`,
            photo: `https://i.pravatar.cc/150?img=${(i % 70) + 1}`,
            age: String(21 + (i % 35)),
            country: countries[i % countries.length],
            interest: interests[i % interests.length],
            netWorthRaw: `$${netWorth.toLocaleString()}`,
            netWorth
        };
    });
}