const express = require("express");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const app = express();
app.use(express.json({limit:"32kb"}));
app.use(express.static("public"));

const BOT_TOKEN = process.env.BOT_TOKEN || "";
const DEV_MODE = process.env.DEV_MODE === "true";
const db = new Database(process.env.DB_FILE || "coin-tap.db");
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY, username TEXT, first_name TEXT,
  coins INTEGER NOT NULL DEFAULT 0,
  energy INTEGER NOT NULL DEFAULT 500,
  max_energy INTEGER NOT NULL DEFAULT 500,
  tap_level INTEGER NOT NULL DEFAULT 1,
  energy_level INTEGER NOT NULL DEFAULT 1,
  energy_updated INTEGER NOT NULL DEFAULT (unixepoch())
);
`);

function verifyTelegram(initData) {
  if (DEV_MODE) return {id:"demo-user", username:"demo", first_name:"Demo"};
  if (!BOT_TOKEN || !initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dataCheck = [...params.entries()].sort(([a],[b])=>a.localeCompare(b))
    .map(([k,v])=>`${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256","WebAppData").update(BOT_TOKEN).digest();
  const calculated = crypto.createHmac("sha256",secret).update(dataCheck).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(hash,"hex"),Buffer.from(calculated,"hex"))) return null;
  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Date.now()/1000-authDate > 86400) return null;
  try { return JSON.parse(params.get("user")); } catch { return null; }
}
function auth(req,res,next) {
  const user = verifyTelegram(req.headers["x-telegram-init-data"] || "");
  if (!user?.id) return res.status(401).json({error:"Open this game inside Telegram."});
  req.user = user;
  next();
}
const getPlayer = db.prepare("SELECT * FROM players WHERE id=?");
const savePlayer = db.prepare(`
INSERT INTO players(id,username,first_name) VALUES(?,?,?)
ON CONFLICT(id) DO UPDATE SET username=excluded.username, first_name=excluded.first_name
`);
function loadPlayer(user) {
  savePlayer.run(String(user.id), user.username || "", user.first_name || "Player");
  let p=getPlayer.get(String(user.id));
  const now=Math.floor(Date.now()/1000);
  const gained=Math.floor((now-p.energy_updated)/5);
  if(gained>0) {
    const energy=Math.min(p.max_energy,p.energy+gained);
    db.prepare("UPDATE players SET energy=?,energy_updated=? WHERE id=?").run(energy,now,String(user.id));
    p=getPlayer.get(String(user.id));
  }
  return p;
}
function publicPlayer(p) {
  return {coins:p.coins,energy:p.energy,maxEnergy:p.max_energy,tapLevel:p.tap_level,
    energyLevel:p.energy_level,tapPower:[0,1,2,5,10][p.tap_level]};
}
app.get("/api/state",auth,(req,res)=>res.json(publicPlayer(loadPlayer(req.user))));
app.post("/api/tap",auth,(req,res)=>{
  const p=loadPlayer(req.user);
  const count=Math.max(1,Math.min(10,Number(req.body.count)||1));
  const taps=Math.min(count,p.energy);
  if(!taps) return res.json(publicPlayer(p));
  const power=[0,1,2,5,10][p.tap_level] || 1;
  const now=Math.floor(Date.now()/1000);
  db.prepare("UPDATE players SET coins=coins+?,energy=energy-?,energy_updated=? WHERE id=?")
    .run(taps*power,taps,now,String(req.user.id));
  res.json(publicPlayer(getPlayer.get(String(req.user.id))));
});
app.post("/api/upgrade",auth,(req,res)=>{
  const p=loadPlayer(req.user);
  const type=req.body.type;
  if(type==="energy") {
    const cost=100*p.energy_level;
    if(p.coins<cost) return res.status(400).json({error:`Need ${cost} COIN.`});
    db.prepare("UPDATE players SET coins=coins-?,max_energy=max_energy+250,energy=min(max_energy+250,energy+250),energy_level=energy_level+1 WHERE id=?")
      .run(cost,String(req.user.id));
  } else if(type==="tap") {
    if(p.tap_level>=4) return res.status(400).json({error:"Tap power is already at maximum."});
    const costs=[0,500,1500,5000];
    const cost=costs[p.tap_level];
    if(p.coins<cost) return res.status(400).json({error:`Need ${cost} COIN.`});
    db.prepare("UPDATE players SET coins=coins-?,tap_level=tap_level+1 WHERE id=?").run(cost,String(req.user.id));
  } else return res.status(400).json({error:"Unknown upgrade."});
  res.json(publicPlayer(loadPlayer(req.user)));
});
app.get("/api/leaderboard",auth,(req,res)=>{
  const rows=db.prepare("SELECT first_name,username,coins FROM players ORDER BY coins DESC LIMIT 20").all();
  res.json(rows.map((p,i)=>({rank:i+1,name:p.username?("@"+p.username):p.first_name,coins:p.coins})));
});
async function startTelegramBot() {
  if (!BOT_TOKEN) return;

  let offset = 0;

  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`);

  while (true) {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset}&timeout=30`
      );

      const data = await response.json();

      if (data.ok) {
        for (const update of data.result) {
          offset = update.update_id + 1;

          const msg = update.message;
          if (!msg || !msg.text) continue;

          if (msg.text.startsWith("/start")) {
            await fetch(
              `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
              {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                  chat_id: msg.chat.id,
                  text: "👋 Добро пожаловать в Coin Tap!\n\n🎮 Нажми Играть и начинай зарабатывать монеты!",
                  reply_markup: {
                    inline_keyboard: [[
                      {
                        text: "🎮 Играть",
                        url: "https://coin-tap.onrender.com/"
                      }
                    ]]
                  }
                })
              }
            );
          }
        }
      }
    } catch (error) {
      console.log("Telegram error:", error.message);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

startTelegramBot();const port=process.env.PORT||3000;
app.listen(port,"0.0.0.0",()=>console.log(`Coin Tap running on ${port}`));
