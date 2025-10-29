const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');

// Boss base saatleri - dakika son rakamı UI'dan ayarlanacak
const BOSS_BASE_TIMES = [
    '00:3', '02:0', '03:3', '05:0',
    '06:3', '08:0', '09:3', '11:0', 
    '12:3', '14:0', '15:3', '17:0',
    '18:3', '20:0', '21:3', '23:0'
];

let bossMinuteDigit = 5; // UI'dan ayarlanacak son rakam
let BOSS_TIMES = []; // Dinamik olarak oluşturulacak
let reminderMinutes = 5;
let currentJobs = [];
let mainWindow;
let warningWindow = null;
let tray = null;
let selectedSoundPath = null; // Mutlak path veya null
let isQuitting = false;
let snoozeTimer = null;

// Kalıcı ayar dosyası
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

function ensureDirExists(dirPath) {
    try {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    } catch (e) {
        console.error('Klasör oluşturulamadı:', dirPath, e);
    }
}

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
            const cfg = JSON.parse(raw);
            if (typeof cfg.bossMinuteDigit === 'number') bossMinuteDigit = cfg.bossMinuteDigit;
            if (typeof cfg.reminderMinutes === 'number') reminderMinutes = cfg.reminderMinutes;
            if (typeof cfg.selectedSoundPath === 'string') selectedSoundPath = cfg.selectedSoundPath;
        }
    } catch (e) {
        console.error('Config okunamadı:', e);
    }
}

function saveConfig() {
    try {
        const data = {
            bossMinuteDigit,
            reminderMinutes,
            selectedSoundPath
        };
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        console.error('Config yazılamadı:', e);
    }
}

// sounds klasörü desteği
const SOUNDS_DIR = path.join(__dirname, 'sounds');
ensureDirExists(SOUNDS_DIR);

function listAvailableSounds() {
    try {
        if (!fs.existsSync(SOUNDS_DIR)) return [];
        const files = fs.readdirSync(SOUNDS_DIR, { withFileTypes: true });
        const allowed = ['.mp3', '.wav', '.ogg'];
        return files
            .filter(d => d.isFile())
            .filter(d => allowed.includes(path.extname(d.name).toLowerCase()))
            .map(d => {
                const p = path.join(SOUNDS_DIR, d.name);
                return {
                    name: d.name,
                    path: p
                };
            });
    } catch (e) {
        console.error('Ses listesi okunamadı:', e);
        return [];
    }
}

// Boss saatlerini dinamik olarak oluştur
function generateBossTimes() {
    BOSS_TIMES = BOSS_BASE_TIMES.map(baseTime => `${baseTime}${bossMinuteDigit}`);
    console.log(`🎯 Boss saatleri güncellendi: ${BOSS_TIMES.join(', ')}`);
}

function clearAllJobs() {
    currentJobs.forEach(job => {
        if (job && job.destroy) {
            job.destroy();
        }
    });
    currentJobs = [];
}

function setupBossReminders() {
    clearAllJobs();
    generateBossTimes(); // Boss saatlerini yeniden oluştur
    
    console.log(`🗡️ Boss hatırlatıcıları kuruluyor - ${reminderMinutes} dakika önceden uyarı!`);
    
    BOSS_TIMES.forEach(bossTime => {
        const [hour, minute] = bossTime.split(':').map(Number);
        
        let reminderHour = hour;
        let reminderMinute = minute - reminderMinutes;
        
        if (reminderMinute < 0) {
            reminderMinute += 60;
            reminderHour -= 1;
        }
        if (reminderHour < 0) {
            reminderHour += 24;
        }
        
        const cronPattern = `${reminderMinute} ${reminderHour} * * *`;
        console.log(`⏰ ${bossTime} boss'u için ${String(reminderHour).padStart(2, '0')}:${String(reminderMinute).padStart(2, '0')} da uyarı kuruldu`);
        
        const job = cron.schedule(cronPattern, () => {
            showBossWarning(bossTime, reminderMinutes);
        }, {
            scheduled: true,
            timezone: "Europe/Istanbul"
        });
        
        currentJobs.push(job);
    });
}

function showBossWarning(bossTime, minutesLeft) {
    console.log(`🚨 BOSS UYARI! ${bossTime} boss'una ${minutesLeft} dakika kaldı!`);
    
    if (warningWindow && !warningWindow.isDestroyed()) {
        warningWindow.focus();
        return;
    }
    
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    
    warningWindow = new BrowserWindow({
        width: 600,
        height: 500,
        x: Math.round((width - 600) / 2),
        y: Math.round((height - 500) / 2),
        frame: false,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        show: false
    });
    
    // Warning HTML'i yükle
    const query = {
        bossTime: bossTime,
        minutesLeft: minutesLeft
    };
    if (selectedSoundPath && fs.existsSync(selectedSoundPath)) {
        // file:// URL olarak gönder
        query.soundPath = `file://${selectedSoundPath.replace(/\\/g, '/')}`;
    }

    warningWindow.loadFile('./desk/warning-desktop.html', {
        query
    });
    
    warningWindow.once('ready-to-show', () => {
        warningWindow.setAlwaysOnTop(true, 'screen-saver');
        warningWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        warningWindow.show();
        warningWindow.focus();
        warningWindow.flashFrame(true);
    });
    
    warningWindow.on('closed', () => {
        warningWindow = null;
    });
}

function getNextBossInfo() {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    
    let nextBoss = null;
    let timeUntilBoss = Infinity;
    
    BOSS_TIMES.forEach(bossTime => {
        const [bossHour, bossMinute] = bossTime.split(':').map(Number);
        const bossDate = new Date();
        bossDate.setHours(bossHour, bossMinute, 0, 0);
        
        if (bossDate <= now) {
            bossDate.setDate(bossDate.getDate() + 1);
        }
        
        const timeDiff = bossDate - now;
        if (timeDiff < timeUntilBoss) {
            timeUntilBoss = timeDiff;
            nextBoss = bossTime;
        }
    });
    
    const minutesUntil = Math.floor(timeUntilBoss / (1000 * 60));
    return { nextBoss, minutesUntil, currentTime };
}

function createWindow() {
    // Pencere ikonu: öncelik PNG, yoksa ICO
    let winIcon;
    try {
        const iconPng = path.join(__dirname, 'assets', 'icon.png');
        if (fs.existsSync(iconPng)) {
            winIcon = nativeImage.createFromPath(iconPng);
        } else {
            const iconIco = path.join(__dirname, 'assets', 'icon.ico');
            if (fs.existsSync(iconIco)) winIcon = iconIco;
        }
    } catch {}

    mainWindow = new BrowserWindow({
        width: 500,
        height: 680,
        frame: false,
        autoHideMenuBar: true,
        resizable: false,
        maximizable: false,
        fullscreenable: false,
        show: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        icon: winIcon,
        title: 'Metin2 Boss Hatırlatıcı 🗡️'
    });

    mainWindow.loadFile('./desk/index-desktop.html');
    
    // Geliştirme için DevTools kapalı
    // mainWindow.webContents.openDevTools();

    // Minimize ve close davranışı: tepsiye gizle
    mainWindow.on('minimize', (e) => {
        e.preventDefault();
        try { mainWindow.setSkipTaskbar(true); } catch {}
        ensureTray();
        mainWindow.hide();
    });

    mainWindow.on('close', (e) => {
        if (!isQuitting) {
            e.preventDefault();
            try { mainWindow.setSkipTaskbar(true); } catch {}
            ensureTray();
            mainWindow.hide();
        }
    });

    mainWindow.on('show', () => {
        // Görünürken tray ikonunu kaldır
        destroyTray();
        try { mainWindow.setSkipTaskbar(false); } catch {}
    });
}

// IPC handlers
ipcMain.handle('save-settings', (event, data) => {
    const { bossMinuteDigit: newBossMinuteDigit, reminderMinutes: newReminderMinutes, selectedSoundPath: newSelectedSoundPath } = data;
    
    // Uyarı dakikasını güncelle
    if (newReminderMinutes && newReminderMinutes >= 1 && newReminderMinutes <= 60) {
        reminderMinutes = newReminderMinutes;
    }
    
    // Boss dakika son rakamını güncelle
    if (newBossMinuteDigit !== undefined && newBossMinuteDigit >= 0 && newBossMinuteDigit <= 9) {
        bossMinuteDigit = newBossMinuteDigit;
    }

    // Ses dosyası yolu
    if (typeof newSelectedSoundPath === 'string') {
        selectedSoundPath = newSelectedSoundPath || null;
    }
    
    setupBossReminders();
    saveConfig();
    
    console.log(`✅ Ayarlar güncellendi: Boss dakika sonu=${bossMinuteDigit}, ${reminderMinutes} dakika önceden uyarı!`);
    const bossInfo = getNextBossInfo();
    console.log(`📊 Bir sonraki boss: ${bossInfo.nextBoss} (${bossInfo.minutesUntil} dakika sonra)`);
    
    return {
        success: true,
        message: `Boss saatleri güncellendi! Son rakam: ${bossMinuteDigit}`,
        nextBoss: bossInfo.nextBoss,
        minutesUntil: bossInfo.minutesUntil,
        bossTimes: BOSS_TIMES,
        selectedSoundPath
    };
});

ipcMain.handle('close-warning', () => {
    if (warningWindow && !warningWindow.isDestroyed()) {
        warningWindow.close();
    }
    return { success: true };
});

ipcMain.handle('get-status', () => {
    const bossInfo = getNextBossInfo();
    return {
        reminderMinutes,
        bossMinuteDigit,
        currentTime: bossInfo.currentTime,
        nextBoss: bossInfo.nextBoss,
        minutesUntilBoss: bossInfo.minutesUntil,
        activeBossCount: BOSS_TIMES.length,
        bossTimes: BOSS_TIMES,
        selectedSoundPath
    };
});

ipcMain.handle('list-sounds', () => {
    return listAvailableSounds();
});

ipcMain.handle('minimize-main', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        try { mainWindow.setSkipTaskbar(true); } catch {}
        ensureTray();
        mainWindow.hide();
    }
});

ipcMain.handle('test-warning', () => {
    const info = getNextBossInfo();
    const bt = info.nextBoss || 'TEST-00:00';
    showBossWarning(bt, 0);
    return { success: true };
});

ipcMain.handle('snooze-warning', (event, args) => {
    try {
        const bossTime = args && typeof args.bossTime === 'string' ? args.bossTime : null;
        const delayMs = args && typeof args.delayMs === 'number' ? Math.max(1000, args.delayMs) : 60000;
        if (!bossTime) {
            return { success: false, error: 'bossTime missing' };
        }
        if (snoozeTimer) {
            clearTimeout(snoozeTimer);
            snoozeTimer = null;
        }
        // Mevcut uyarıyı kapat
        if (warningWindow && !warningWindow.isDestroyed()) {
            warningWindow.close();
        }
        // 1 dakika sonra tekrar uyar
        snoozeTimer = setTimeout(() => {
            showBossWarning(bossTime, 0);
            snoozeTimer = null;
        }, delayMs);
        return { success: true };
    } catch (e) {
        return { success: false, error: String(e) };
    }
});

// Tek instance kilidi
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            try { mainWindow.setSkipTaskbar(false); } catch {}
            mainWindow.show();
            mainWindow.focus();
            destroyTray();
        }
    });
}

app.whenReady().then(() => {
    console.log('🗡️ METIN2 BOSS HATIRLATICI BAŞLATILDI! ⚔️');
    try { app.setAppUserModelId('com.bosshatirlatici.app'); } catch {}
    // Config yükle
    loadConfig();

    // İlk başta varsayılan boss saatlerini oluştur
    generateBossTimes();
    console.log('🎯 Boss base saatleri yüklendi:', BOSS_BASE_TIMES.map(t => `${t}X`).join(', '));
    // Kalıcı ayarlarla cron kur
    setupBossReminders();
    console.log(`🎯 Şu anki boss saatleri (son rakam=${bossMinuteDigit}):`, BOSS_TIMES.join(', '));
    
    const bossInfo = getNextBossInfo();
    console.log(`⏰ Şu anki saat: ${bossInfo.currentTime}`);
    console.log(`🔜 Bir sonraki boss: ${bossInfo.nextBoss} (${bossInfo.minutesUntil} dakika sonra)`);
    
    createWindow();

    // Uygulama menüsünü tamamen kaldır
    try { Menu.setApplicationMenu(null); } catch {}

    // Başlangıçta tray oluşturma; yalnızca gizliyken oluşturacağız

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
        // macOS veya başka durumlarda görünürken tray'i kaldır
        destroyTray();
    });
});

app.on('window-all-closed', () => {
    // macOS dışı platformlarda uygulamayı açık tutmayacağız; cron işleri temizle
    clearAllJobs();
    if (process.platform !== 'darwin') {
        isQuitting = true;
        app.quit();
    }
});

app.on('before-quit', () => {
    clearAllJobs();
    isQuitting = true;
    destroyTray();
});

// Tray yardımcıları
function ensureTray() {
    if (tray) return;
    try {
        const { nativeImage } = require('electron');

        function pickPngByDpi() {
            const scale = screen.getPrimaryDisplay().scaleFactor || 1;
            let desired = 16;
            if (scale >= 3) desired = 48; else if (scale >= 2) desired = 32; else if (scale >= 1.5) desired = 24; else desired = 16;
            const candidates = [desired, 32, 24, 16, 48, 64];
            for (const size of candidates) {
                const p = path.join(__dirname, 'assets', `icon-${size}.png`);
                if (fs.existsSync(p)) return { path: p, size };
            }
            const generic = path.join(__dirname, 'assets', 'icon.png');
            if (fs.existsSync(generic)) return { path: generic, size: desired };
            return null;
        }

        let nativeImg;
        const pngPick = pickPngByDpi();
        if (pngPick) {
            nativeImg = nativeImage.createFromPath(pngPick.path);
            if (!nativeImg.isEmpty()) {
                nativeImg = nativeImg.resize({ width: pngPick.size, height: pngPick.size, quality: 'best' });
            }
        }
        if (!nativeImg || nativeImg.isEmpty()) {
            const icoPath = path.join(__dirname, 'assets', 'icon.ico');
            if (fs.existsSync(icoPath)) {
                nativeImg = nativeImage.createFromPath(icoPath);
            }
        }
        if (!nativeImg || nativeImg.isEmpty()) {
            const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAAM1BMVEUAy+v///8Ay+sAy+sAy+v8/PwAy+v19fUAy+v7+/sAy+v4+PgAy+v39/cAy+v09PQAy+t9Yy9YAAAAD3RSTlMABw4jRk1hc4zO7vC9b4rZ2K5fCwAAAHZJREFUGNNjYGBkYmBhZGBgYFBQZGBg+P//PwMxgQEMDAwMDDCYgZGBgQEQaGBiYGBgYGBYQxgQFRQ2gSEwMDQxgYGBxQ4gYgEGwJgkYGCgQhQGgQmBgYGB4g8Qw0gYGBgQHjA0A0gYGBgYHhB2gYQbGkAAjYcGQhZIa8wAAAABJRU5ErkJggg==';
            nativeImg = nativeImage.createFromBuffer(Buffer.from(base64Png, 'base64'));
        }

        tray = new Tray(nativeImg);
        const contextMenu = Menu.buildFromTemplate([
            { label: 'Aç', type: 'normal', click: () => {
                if (mainWindow) {
                    try { mainWindow.setSkipTaskbar(false); } catch {}
                    mainWindow.show();
                    mainWindow.focus();
                    destroyTray();
                }
            } },
            { label: 'Çıkış', type: 'normal', click: () => { isQuitting = true; app.quit(); } }
        ]);
        tray.setToolTip('Metin2 Boss Hatırlatıcı');
        tray.setContextMenu(contextMenu);
        tray.on('click', () => {
            if (mainWindow) {
                try { mainWindow.setSkipTaskbar(false); } catch {}
                mainWindow.show();
                mainWindow.focus();
                destroyTray();
            }
        });
    } catch (e) {
        console.warn('Tray oluşturulamadı:', e);
    }
}

function destroyTray() {
    if (tray) {
        try { tray.destroy(); } catch {}
        tray = null;
    }
}

// Uygulamayı tamamen kapatmak için IPC
ipcMain.handle('quit-app', () => {
    isQuitting = true;
    app.quit();
});