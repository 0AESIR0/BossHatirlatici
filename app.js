const express = require('express');
const path = require('path');
const fs = require('fs');
const open = require('open');
const cron = require('node-cron');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(__dirname));

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
    
    const warningUrl = `http://localhost:${PORT}/warning.html?bossTime=${bossTime}&minutesLeft=${minutesLeft}`;
    
    open(warningUrl, {
        app: {
            name: open.apps.chrome,
            arguments: [
                '--new-window',
                '--always-on-top',
                '--disable-web-security',
                '--allow-running-insecure-content',
                `--window-size=600,500`,
                `--window-position=400,200`
            ]
        }
    }).catch(err => {
        console.error('Uyarı penceresi açılamadı:', err);
        
        open(warningUrl).catch(err2 => {
            console.error('Varsayılan tarayıcı ile de açılamadı:', err2);
        });
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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/warning.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'warning.html'));
});

app.post('/save-settings', (req, res) => {
    const { reminderMinutes: newReminderMinutes, bossMinuteDigit: newBossMinuteDigit } = req.body;
    
    // Uyarı dakikasını güncelle (opsiyonel, varsayılan 5 kalabilir)
    if (newReminderMinutes && newReminderMinutes >= 1 && newReminderMinutes <= 60) {
        reminderMinutes = newReminderMinutes;
    }
    
    // Boss dakika son rakamını güncelle
    if (newBossMinuteDigit !== undefined && newBossMinuteDigit >= 0 && newBossMinuteDigit <= 9) {
        bossMinuteDigit = newBossMinuteDigit;
    }
    
    setupBossReminders();
    
    console.log(`✅ Ayarlar güncellendi: Boss dakika sonu=${bossMinuteDigit}, ${reminderMinutes} dakika önceden uyarı!`);
    const bossInfo = getNextBossInfo();
    console.log(`📊 Bir sonraki boss: ${bossInfo.nextBoss} (${bossInfo.minutesUntil} dakika sonra)`);
    
    res.json({ 
        success: true, 
        message: `Boss saatleri güncellendi! Son rakam: ${bossMinuteDigit}`,
        nextBoss: bossInfo.nextBoss,
        minutesUntil: bossInfo.minutesUntil,
        bossTimes: BOSS_TIMES
    });
});

app.post('/close-warning', (req, res) => {
    console.log('📄 Uyarı penceresi kapatıldı');
    res.json({ success: true });
});

app.get('/status', (req, res) => {
    const bossInfo = getNextBossInfo();
    res.json({
        reminderMinutes,
        currentTime: bossInfo.currentTime,
        nextBoss: bossInfo.nextBoss,
        minutesUntilBoss: bossInfo.minutesUntil,
        activeBossCount: BOSS_TIMES.length
    });
});

app.listen(PORT, () => {
    console.log('🗡️ METIN2 BOSS HATIRLATICI BAŞLATILDI! ⚔️');
    console.log(`📡 Server çalışıyor: http://localhost:${PORT}`);
    
    // İlk başta varsayılan boss saatlerini oluştur
    generateBossTimes();
    console.log('🎯 Boss base saatleri yüklendi:', BOSS_BASE_TIMES.join(', ') + 'X');
    console.log(`🎯 Şu anki boss saatleri (son rakam=${bossMinuteDigit}):`, BOSS_TIMES.join(', '));
    
    const bossInfo = getNextBossInfo();
    console.log(`⏰ Şu anki saat: ${bossInfo.currentTime}`);
    console.log(`🔜 Bir sonraki boss: ${bossInfo.nextBoss} (${bossInfo.minutesUntil} dakika sonra)`);
    console.log('🚀 Ayarları yapmak için tarayıcıyı açıyorum...\n');
    
    setTimeout(() => {
        open(`http://localhost:${PORT}`).catch(err => {
            console.log('❌ Tarayıcı açılamadı. Manuel olarak şu adrese git: http://localhost:3000');
        });
    }, 1000);
});

process.on('SIGINT', () => {
    console.log('\n🛑 Boss hatırlatıcısı kapatılıyor...');
    clearAllJobs();
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    console.error('💥 Beklenmeyen hata:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Promise hatası:', reason);
});