// Brick Breaker with a shop: buy balls, release them to break bricks and earn money.
(() => {
	let canvas = document.getElementById('gameCanvas');
	let ctx = canvas.getContext('2d');

	// UI elements
	const moneyEl = document.getElementById('money');
	const ballsOwnedEl = document.getElementById('ballsOwned');
	const buyBallBtn = document.getElementById('buyBall');
	const buyBtn = document.getElementById('buyBtn');
	const buyMenu = document.getElementById('buyMenu');
	const resetBtn = document.getElementById('resetBtn');
    const soundToggleBtn = document.getElementById('soundToggle');

	// Hi-DPI scaling
	function fitCanvas() {
		const cssW = canvas.width;
		const cssH = canvas.height;
		// Cap DPR to avoid extremely large canvas sizes on high-DPI displays which
		// can dramatically reduce rendering performance.
		const rawDpr = Math.max(1, window.devicePixelRatio || 1);
		const dpr = Math.min(rawDpr, 1.5);
		canvas.width = cssW * dpr;
		canvas.height = cssH * dpr;
		canvas.style.width = cssW + 'px';
		canvas.style.height = cssH + 'px';
		ctx.setTransform(dpr,0,0,dpr,0,0);
	}
	fitCanvas();

	// Game state
	const START_MONEY = 0; // starting money to let player buy a ball
	const START_BALL_PRICE = 10;
	// maximum number of balls that can be active at once (adjustable)
	const DEFAULT_MAX_ACTIVE_BALLS = 20;
	let maxActiveBalls = DEFAULT_MAX_ACTIVE_BALLS;
	let money = START_MONEY;
	let gems = 0; // special currency awarded on rebirth
	let rebirths = 0; // number of times player has rebirthed
	let ballPrice = START_BALL_PRICE;
	let ballsOwned = 0; // in inventory; release moves them into activeBalls
	let level = 1; // current level
    // Boss state (present on every 10th level)
    let boss = null;
    let bossTimer = 0;
    const BOSS_TIME_LIMIT_BASE = 30; // seconds
	// admin override: force 100% crit chance (initialized from localStorage if present)
	let adminForceFullCrit = false;
	try{ adminForceFullCrit = !!(localStorage.getItem && localStorage.getItem('bb-admin-forceCrit') === '1'); }catch(e){ adminForceFullCrit = false; }

	const activeBalls = [];
	const bricks = [];

	const GAME = {
		width: parseInt(canvas.style.width || canvas.width || 800, 10) || 800,
		height: parseInt(canvas.style.height || canvas.height || 600, 10) || 600,
	};

	// Level transition state (controls fade overlay and pause)
	const levelTransition = {
		active: false,
		start: 0,
		duration: 1400, // ms total: fade-out + hold + fade-in
		nextLevel: null,
		fadeOut: 400,
		hold: 600,
		fadeIn: 400
	};

	let _nowTime = performance.now(); // updated in loop for draw/time-based effects

	function startLevelTransition(nextLvl){
		if(levelTransition.active) return;
		levelTransition.active = true;
		levelTransition.start = performance.now();
		levelTransition.nextLevel = nextLvl;
		// temporarily disable canvas clicks during transition
		if(canvas) canvas.style.pointerEvents = 'none';
	}

	function finalizeLevelTransition(){
		level = levelTransition.nextLevel || (level + 1);
		initBricks(level);
		// reposition active balls to center and reset velocities (reuse logic used previously)
		try{
			// remove scatter child balls on level complete so each level restarts clean
			for(let i = activeBalls.length - 1; i >= 0; i--){
				if(activeBalls[i] && activeBalls[i].isScatterChild){ activeBalls.splice(i,1); }
			}
			for(const b of activeBalls){
				if(!b) continue;
				b.x = GAME.width/2 + (Math.random()-0.5)*20;
				b.y = GAME.height - 28;
				let vx = (Math.random()-0.5)*1.2;
				let vy = -3.5 - Math.random()*1.2;
				// adjust per-type like spawnBall
				switch(b.type){
					case 'heavy':
						b.r = 8; vx *= 0.6; vy *= 0.6; break;
					case 'sniper':
						b.r = 5; vx *= 1.1; vy *= 1.1; break;
					default:
						b.r = 6;
				}
				// convert to pixels-per-second for consistent dt integration
				// convert to pps and apply speed upgrades multiplier once
				b.vx = vx * 60; b.vy = vy * 60; b.alive = true;
				try{ const sp = computeTypeSpeed(b.type); b.vx *= sp; b.vy *= sp; }catch(e){}
				try{ b.damage = computeTypeDamage(b.type); }catch(e){}
				// reset sniper state flags so they behave correctly on the new level
				if(b.type === 'sniper'){
					b.sniperCanRetarget = true;
					b.sniperHitBrick = false;
				}
				// reset scatter-specific spawn counters so they can spawn children on the new level
				if(b.type === 'scatter'){
					b._lastScatterSpawn = 0;
					b._scatterChildrenSpawned = 0;
				}
			}
		}catch(e){ }
		saveGame();
		levelTransition.active = false;
		levelTransition.nextLevel = null;
		// re-enable canvas interaction
		if(canvas) canvas.style.pointerEvents = '';
	}

	// Snow particle system for Christmas theme (drawn to full-window `snowCanvas`)
	const snowParticles = [];
	// temporary cartoon crit bubbles shown on critical hits
	const critBubbles = [];
	const snowCanvas = document.getElementById('snowCanvas');
	const snowCtx = snowCanvas ? snowCanvas.getContext('2d') : null;

	function spawnCritBubble(x,y){
		const texts = ['Boom!','Pow!','Bang!'];
		const text = texts[Math.floor(Math.random()*texts.length)];
		critBubbles.push({ x, y, text, t:0, ttl:0.9, vy: -40 - Math.random()*20, scale: 1 + Math.random()*0.25, rot: (Math.random()-0.5)*0.25 });
	}

	// Sound system: defaults to off. Expose simple API on window._sounds
	let soundsEnabled = false;
	let _audioCtx = null;
	function ensureAudioContext(){
		try{
			if(!_audioCtx){
				_audioCtx = new (window.AudioContext || window.webkitAudioContext)();
			}
			if(_audioCtx && _audioCtx.state === 'suspended') _audioCtx.resume().catch(()=>{});
			return _audioCtx;
		}catch(e){ return null; }
	}

	function playTone(freq = 440, type='sine', duration = 0.08, vol = 0.08){
		if(!soundsEnabled) return;
		const ac = ensureAudioContext();
		if(!ac) return;
		const o = ac.createOscillator();
		const g = ac.createGain();
		o.type = type;
		o.frequency.value = freq;
		g.gain.value = vol;
		o.connect(g); g.connect(ac.destination);
		const now = ac.currentTime;
		g.gain.setValueAtTime(vol, now);
		g.gain.exponentialRampToValueAtTime(0.001, now + duration);
		o.start(now);
		o.stop(now + duration + 0.02);
	}

	window._sounds = {
		enabled: ()=> soundsEnabled,
		setEnabled: (v)=>{ soundsEnabled = !!v; try{ localStorage.setItem('bb-sounds', soundsEnabled ? '1' : '0'); }catch(e){} },
		playHit: (strength = 1)=>{
			if(!soundsEnabled) return;
			// map strength to frequency and type
			const s = Math.min(1, Math.max(0.05, Math.abs(strength) / 50));
			const freq = 300 + s * 1200 + (Math.random()-0.5)*40;
			const type = (s > 0.6) ? 'square' : ((s > 0.25) ? 'sawtooth' : 'sine');
			playTone(freq, type, 0.08 + s*0.12, 0.06 + s*0.06);
		}
	};

	// restore sound preference (default off)
	try{ soundsEnabled = !!(localStorage.getItem && localStorage.getItem('bb-sounds') === '1'); }catch(e){ soundsEnabled = false; }


	function fitSnowCanvas(){
		if(!snowCanvas || !snowCtx) return;
		const w = window.innerWidth;
		const h = window.innerHeight;
		const rawDpr = Math.max(1, window.devicePixelRatio || 1);
		const dpr = Math.min(rawDpr, 1.5);
		snowCanvas.width = Math.floor(w * dpr);
		snowCanvas.height = Math.floor(h * dpr);
		snowCanvas.style.width = w + 'px';
		snowCanvas.style.height = h + 'px';
		snowCtx.setTransform(dpr,0,0,dpr,0,0);
	}

	function initSnow(count = 80){
		snowParticles.length = 0;
		const w = (snowCanvas && snowCanvas.clientWidth) ? snowCanvas.clientWidth : window.innerWidth;
		const h = (snowCanvas && snowCanvas.clientHeight) ? snowCanvas.clientHeight : window.innerHeight;
		for(let i=0;i<count;i++){
			// snowflake properties: position, size, fall speed, horizontal drift, rotation
			const size = 1 + Math.random()*3.5;
			snowParticles.push({
				x: Math.random()*w,
				y: Math.random()*h,
				r: size,
				speed: 10 + Math.random()*30 * (size/2),
				drift: (Math.random()-0.5)*18,
				angle: Math.random() * Math.PI * 2,
				spin: (Math.random()-0.5) * 1.2,
				alpha: 0.6 + Math.random()*0.4,
				branches: 4 + (Math.random() > 0.7 ? 2 : 0) // 4 or 6 branches sometimes
			});
		}
	}

	// Initialize snow canvas sizing + particles
	fitSnowCanvas();
	initSnow(120);

	// wire up sound toggle UI (settings menu button)
	function updateSoundToggleUI(){
		if(!soundToggleBtn) return;
		soundToggleBtn.textContent = `Sounds: ${soundsEnabled ? 'On' : 'Off'}`;
	}
	updateSoundToggleUI();
	if(soundToggleBtn){
		soundToggleBtn.addEventListener('click', (e)=>{
			e.stopPropagation();
			// toggle and persist
			soundsEnabled = !soundsEnabled;
			try{ localStorage.setItem('bb-sounds', soundsEnabled ? '1' : '0'); }catch(e){}
			// create/resume audio ctx on enable so audio will play after user gesture
			if(soundsEnabled) try{ ensureAudioContext(); }catch(e){}
			updateSoundToggleUI();
		});
	}

	// Brick layout
	function initBricks(lvl = 1){
		bricks.length = 0;
		boss = null;
		bossTimer = 0;
		// If this is a boss level (every 10th), create a single boss orb instead of normal bricks
		if(lvl % 10 === 0){
			// Make bosses much tougher: base 1000 HP per level, minimum 5000 HP
			const bossHP = Math.max(5000, Math.round(1000 * lvl));
			const r = Math.min(60, 28 + Math.floor(lvl/10)*6);
			boss = { x: GAME.width/2, y: 140, r: r, value: bossHP, maxValue: bossHP, alive: true };
			bossTimer = BOSS_TIME_LIMIT_BASE; // seconds
			console.log('Boss level', lvl, 'spawned with HP', bossHP, 'time limit', bossTimer);
			return;
		}
		// scale layout with level
		const rows = Math.min(8, 4 + Math.floor((lvl-1)/1));
		const cols = Math.min(12, 7 + Math.floor((lvl-1)/2));
		const padding = 6;
		const offsetTop = 40;
		const totalPad = padding * (cols + 1);
		const brickW = Math.floor((GAME.width - totalPad) / cols);
		const brickH = 22;

		// Per-brick value scales linearly: each level adds $5 per brick
		const totalBricks = rows * cols;
		const perBrick = 5 * lvl; // $5 for level1, $10 for level2, etc.
		for(let r=0;r<rows;r++){
			for(let c=0;c<cols;c++){
				const x = padding + c * (brickW + padding);
				const y = offsetTop + r * (brickH + padding);
				const value = perBrick;
				bricks.push({x,y,w:brickW,h:brickH,value,alive:true,maxValue:value});
			}
		}
		let targetTotal = perBrick * totalBricks;
		const totalMoney = bricks.reduce((s,b) => s + (b.value||0), 0);
		console.log('initBricks: created', bricks.length, 'bricks — total money = $' + totalMoney + ' (target $' + targetTotal + ')');
	}

	initBricks();

	// inventory by type (declared early so loadGame can restore into it)
	const ballsByType = {};
	// default starting inventory: give the player 20 standard balls by default
	ballsByType['standard'] = 20;
	// upgrades object must be declared early so loadGame can restore into it
	const upgrades = {};

	// purchases & gem-shop state (persisted)
	const purchases = {};

	// current prices per ball type (will scale up as player buys)
	const pricesByType = {};
	// detect whether the game has been run before; used to avoid re-spawning defaults after a reset
	const _seenFlag = localStorage.getItem('brickbreaker-seen');
	const firstRun = !_seenFlag;

	// Try to load saved game state (if any)
	function loadGame(){
		try{
			const raw = localStorage.getItem('brickbreaker-save');
			if(!raw) return false;
			const obj = JSON.parse(raw);
			if(!obj) return false;
			// restore simple values
			if(typeof obj.money === 'number') money = obj.money;
			if(typeof obj.ballPrice === 'number') ballPrice = obj.ballPrice;
			if(typeof obj.ballsOwned === 'number') ballsOwned = obj.ballsOwned;
	            if(typeof obj.maxActiveBalls === 'number') maxActiveBalls = obj.maxActiveBalls;
			if(typeof obj.gems === 'number') gems = obj.gems;
			if(typeof obj.rebirths === 'number') rebirths = obj.rebirths;
			if(obj.ballsByType) Object.assign(ballsByType, obj.ballsByType);
			if(obj.upgrades) Object.assign(upgrades, obj.upgrades);
			if(obj.purchases) Object.assign(purchases, obj.purchases);
			if(obj.pricesByType) Object.assign(pricesByType, obj.pricesByType);
			// restore bricks if present
			if(typeof obj.level === 'number') level = obj.level || 1;
			if(Array.isArray(obj.bricks)){
				bricks.length = 0;
				for(const b of obj.bricks){
					// restore props (x,y,w,h,value,alive,maxValue)
					const val = (typeof b.value === 'number') ? +b.value : ((typeof b.hp === 'number') ? +b.hp : ((typeof b.maxHp === 'number') ? +b.maxHp : 0));
					const maxV = (typeof b.maxValue === 'number') ? +b.maxValue : val;
					// if saved `alive` is present use it; otherwise derive from value > 0
					const aliveFlag = (typeof b.alive === 'boolean') ? b.alive : (val > 0);
					bricks.push({
						x:+b.x,
						y:+b.y,
						w:+b.w,
						h:+b.h,
						value: val,
						maxValue: maxV,
						alive: aliveFlag
					});
				}
			}
			return true;
		}catch(e){
			console.warn('Failed to load save', e);
			return false;
		}
	}

	function saveGame(){
		try{
			const obj = {
				version: 1,
				money,
				gems,
				purchases,
				rebirths,
				ballPrice,
				maxActiveBalls,
				ballsOwned,
				ballsByType,
				level,
				upgrades,
				pricesByType,
				bricks: bricks.map(b => ({x:b.x,y:b.y,w:b.w,h:b.h,value:b.value,alive:!!b.alive,maxValue: b.maxValue || b.value})),
				lastSaved: Date.now()
			};
			localStorage.setItem('brickbreaker-save', JSON.stringify(obj));
		}catch(e){
			console.warn('Failed to save game', e);
		}
	}

	// apply monetary damage to a brick: dmg is in dollars. Award the min(dmg, remaining value).
	// returns the total awarded amount
	function applyDamageToBrick(br, dmg){
		if(!br || !br.alive) return 0;
		// critical hit calculation (permanent gem stacks)
		const critStacks = (purchases['crit'] || 0);
		const critChance = Math.min(0.5, (critStacks * 0.05)); // cap 50%
		let isCrit = false;
		if(adminForceFullCrit){ isCrit = true; }
		else if(critStacks > 0 && Math.random() < critChance){ isCrit = true; }
		let amount = Math.min(dmg, Math.max(0, br.value));
		if(isCrit){ amount = Math.min(dmg * 2, Math.max(0, br.value)); }
		if(amount <= 0) return 0;
		br.value = Math.max(0, br.value - amount);
		money += amount;
		// play hit sound if enabled
		try{ if(window._sounds && window._sounds.playHit) window._sounds.playHit(amount * (isCrit ? 1.5 : 1)); }catch(e){}
		if(isCrit){ showToast('Critical Hit!'); try{ spawnCritBubble(br.x + br.w/2, br.y + br.h/2); }catch(e){} }
		updateUI();
		saveGame();
		if(br.value <= 0){
			br.alive = false;
			if(bricks.every(b => !b.alive)){
				// start a visual transition before advancing to next level
				startLevelTransition(level + 1);
			}
		}
		return amount;
	}

	function applyDamageToBoss(dmg){
		if(!boss || !boss.alive) return 0;
		const critStacks = (purchases['crit'] || 0);
		const critChance = Math.min(0.5, (critStacks * 0.05));
		let isCrit = false;
		if(adminForceFullCrit){ isCrit = true; }
		else if(critStacks > 0 && Math.random() < critChance){ isCrit = true; }
		let amount = Math.min(dmg, Math.max(0, boss.value));
		if(isCrit){ amount = Math.min(dmg * 2, Math.max(0, boss.value)); }
		if(amount <= 0) return 0;
		boss.value = Math.max(0, boss.value - amount);
		money += amount;
		// play hit sound if enabled (boss hits may be deeper)
		try{ if(window._sounds && window._sounds.playHit) window._sounds.playHit(amount * (isCrit ? 1.5 : 1)); }catch(e){}
		if(isCrit){ showToast('Critical Hit!'); try{ spawnCritBubble(boss.x, boss.y); }catch(e){} }
		updateUI();
		saveGame();
		if(boss.value <= 0){
			boss.alive = false;
			// boss defeated -> advance to next level after transition
			startLevelTransition(level + 1);
		}
		return amount;
	}

	// attempt to load saved state (overrides initial bricks if present)
	const _loaded = loadGame();
	// If a save was loaded but it contains no alive bricks (older saves may omit
	// the `alive` flag), recreate bricks for the current level so the playfield
	// isn't empty.
	if(_loaded){
		const hasAlive = Array.isArray(bricks) && bricks.some(b => b && b.alive);
		if(!hasAlive || bricks.length === 0){
			console.log('No alive bricks in save — reinitializing bricks for level', level);
			initBricks(level);
			try{ saveGame(); }catch(e){}
		}
	}
	// spawn logic:
	// - if a saved game exists, spawn according to saved counts
	// - else if this is the first-ever run (no seen flag), spawn defaults and mark seen
	const centerX = GAME.width/2;
	const centerY = GAME.height/2;
	let availableSpawn = Math.max(0, maxActiveBalls - countActiveCapacityUsed());
	if(_loaded){
		for(const t of Object.keys(ballsByType)){
			if(availableSpawn <= 0) break;
			const count = ballsByType[t] || 0;
			const toSpawn = Math.min(count, availableSpawn);
			for(let i=0;i<toSpawn;i++){
				const jitter = 6; // pixels
				spawnBall(t, centerX + (Math.random()-0.5)*jitter, centerY + (Math.random()-0.5)*jitter);
			}
			availableSpawn -= toSpawn;
		}
	} else if(firstRun){
		// first-ever run: spawn the default starting balls, then mark we've seen the game
		for(const t of Object.keys(ballsByType)){
			if(availableSpawn <= 0) break;
			const count = ballsByType[t] || 0;
			const toSpawn = Math.min(count, availableSpawn);
			for(let i=0;i<toSpawn;i++){
				const jitter = 6;
				spawnBall(t, centerX + (Math.random()-0.5)*jitter, centerY + (Math.random()-0.5)*jitter);
			}
			availableSpawn -= toSpawn;
		}
		try{ localStorage.setItem('brickbreaker-seen','1'); }catch(e){}
	}
	// update UI to reflect restored money/balls
	updateUI();

	function updateUI(){
		moneyEl.textContent = `Money: $${money}`;
		// show active balls and capacity (exclude scatter child balls from the capacity count)
		const activeCount = activeBalls.filter(b => !b.isScatterChild).length;
		ballsOwnedEl.textContent = `Balls: ${activeCount}/${maxActiveBalls}`;
		// show gems if element exists
		const gemsEl = document.getElementById('gems');
		if(gemsEl) gemsEl.textContent = `Gems: ${gems}`;
		// show rebirth count if present
		const rebirthEl = document.getElementById('rebirthTracker');
		if(rebirthEl) rebirthEl.textContent = `Rebirths: ${rebirths}`;
		// support both old single-buy button and new buy dropdown button
		if(typeof buyBallBtn !== 'undefined' && buyBallBtn && buyBallBtn.textContent !== undefined){
			buyBallBtn.textContent = `Buy Ball ($${ballPrice})`;
		}
		if(typeof buyBtn !== 'undefined' && buyBtn && buyBtn.textContent !== undefined){
			buyBtn.textContent = 'Ball Shop';
		}
	}
	updateUI();

	// save periodically in case of long sessions (every 15s)
	setInterval(()=>{
		saveGame();
	}, 15000);

	function buyBall(){
		// legacy buy button: buy one standard ball using current ballPrice
		const curPrice = pricesByType['standard'] || ballPrice;
		if(purchaseBall('standard', 1, curPrice)){
			// scale price up slowly after successful purchase
			pricesByType['standard'] = Math.max(1, Math.round(curPrice * 1.15));
			updateUI();
		}
	}

	// Centralized purchase helper: buys `count` balls of `type` at `price` each (price optional)
	// Returns true if purchase succeeded.
	function purchaseBall(type = 'standard', count = 1, price = null){
		const typeDef = (typeof window !== 'undefined' && Array.isArray(window.BALL_TYPES)) ? (window.BALL_TYPES.find(t => t.id === type) || null) : null;
		const unitPrice = (typeof price === 'number' && price > 0) ? price : (pricesByType[type] || (typeDef ? typeDef.price : START_BALL_PRICE));
		// enforce active ball capacity
		const available = Math.max(0, maxActiveBalls - countActiveCapacityUsed());
		if(available <= 0) return false;
		const wanted = Math.max(0, count);
		const actualCount = Math.min(wanted, available);
		const total = unitPrice * actualCount;
		if(actualCount <= 0) return false;
		if(money < total) return false;
		money -= total;
		for(let i=0;i<actualCount;i++) spawnBall(type);
		ballsByType[type] = (ballsByType[type] || 0) + actualCount;
		updateUI();
		saveGame();
		return true;
	}

	// helper to count active balls of a given type
	function countActiveOfType(type){
		let n = 0;
		for(const b of activeBalls) if(b.type === type) n++;
		return n;
	}

	// sell `count` balls of a given type. Returns number sold.
	function sellBall(type = 'standard', count = 1, unitPrice = null){
		const owned = ballsByType[type] || 0;
		const toSell = Math.min(owned, Math.max(0, count));
		if(toSell <= 0) return 0;
		const typeDef = (typeof window !== 'undefined' && Array.isArray(window.BALL_TYPES)) ? (window.BALL_TYPES.find(t => t.id === type) || null) : null;
		const curBuy = (typeof unitPrice === 'number' && unitPrice > 0) ? unitPrice : (pricesByType[type] || (typeDef ? typeDef.price : 0));
		const sellUnit = curBuy ? Math.floor(curBuy * 0.5) : 0;
		const total = sellUnit * toSell;
		// remove up to `toSell` active balls of this type
		let removed = 0;
		for(let i = activeBalls.length - 1; i >= 0 && removed < toSell; i--){
			if(activeBalls[i].type === type){
				activeBalls.splice(i,1);
				removed++;
			}
		}
		// decrement inventory
		ballsByType[type] = Math.max(0, owned - toSell);
		money += total;
		updateUI();
		saveGame();
		return toSell;
	}

	if(buyBallBtn) buyBallBtn.addEventListener('click', buyBall);

	// Toggle buy dropdown (if present) and populate with ball types.
	// Ball definitions have been moved to `ballTypes.js` which sets `window.BALL_TYPES`.
	// Use that if available, otherwise fall back to an inline default to remain robust.
	const BALL_TYPES = (typeof window !== 'undefined' && Array.isArray(window.BALL_TYPES)) ? window.BALL_TYPES : [
		{ id: 'standard', name: 'Standard', price: 10, baseDamage: 1, desc: 'Balanced ball' },
		{ id: 'heavy', name: 'Heavy', price: 25, baseDamage: 5, desc: 'Slower, much higher damage' },
		{ id: 'sniper', name: 'Sniper', price: 40, baseDamage: 1, desc: 'Seeks nearest brick and prioritizes it; lower damage, auto-aims' },
		{ id: 'scatter', name: 'Scatter', price: 35, baseDamage: 2, desc: 'Splits into smaller balls on hit; children ignore ball limit' }
	];


	// inventory by type (for future use)
	// Only set a default 0 if the loaded save didn't already set a count for that type
	for(const t of BALL_TYPES) if(!(t.id in ballsByType)) ballsByType[t.id] = 0;
	// initialize upgrades defaults
	for(const t of BALL_TYPES) if(!(t.id in upgrades)) upgrades[t.id] = 0;
	// click damage upgrade (separate key)
	if(!('click' in upgrades)) upgrades['click'] = 0;
	// initialize per-type prices (may be overridden by saved data)
	for(const t of BALL_TYPES) if(!(t.id in pricesByType)) pricesByType[t.id] = t.price;

	// Helper: get type definition from available sources (prefers window.BALL_TYPES)
	function getTypeDef(type){
		const source = (typeof window !== 'undefined' && Array.isArray(window.BALL_TYPES) && window.BALL_TYPES.length) ? window.BALL_TYPES : (Array.isArray(BALL_TYPES) ? BALL_TYPES : []);
		return source.find(t => t.id === type) || null;
	}

	// Count how many active balls count against the player's capacity (exclude
	// scatter children which bypass the limit)
	function countActiveCapacityUsed(){
		let n = 0;
		for(const b of activeBalls){ if(!b) continue; if(b.isScatterChild) continue; n++; }
		return n;
	}

	// Scaled upgrade bonus: each upgrade level grants a slightly larger increment.
	// compute upgrade cost scaling with current level and player's money
	function computeUpgradeCost(type){
		const lvl = upgrades[type] || 0;
		// click upgrades start cheaper now (was 100) — base cost for click is 20
		const base = (type === 'click') ? 20 : 50;
		// level factor: small linear increase per game level (keeps difficulty scaling)
		const levelFactor = 1 + (Math.max(0, level) * 0.03);
		// exponential growth per existing upgrade level (per-type)
		const growth = Math.pow(1.18, lvl);
		// NOTE: remove dependency on player's current money so buying one upgrade
		// does not change costs of other upgrades. Costs now depend only on
		// the upgrade's own level and the global game level.
		const cost = Math.ceil(base * growth * levelFactor);
		return cost;
	}
	// We sum geometric growth starting at 1 with multiplier 1.25 (tunable).
	function scaledUpgradeBonus(level){
		let total = 0;
		const baseInc = 1;
		const mult = 1.25;
		for(let k=0;k<level;k++){
			total += Math.round(baseInc * Math.pow(mult, k));
		}
		return total;
	}

	function computeTypeDamage(type){
		const def = getTypeDef(type);
		const base = (def && typeof def.baseDamage === 'number') ? def.baseDamage : 1;
		const lvl = upgrades[type] || 0;
		const extra = scaledUpgradeBonus(lvl);
		return base + extra;
	}

	// compute speed multiplier for a given ball type based on speed upgrades
	function computeTypeSpeed(type){
		const key = `${type}-speed`;
		const lvl = upgrades[key] || 0;
		if(lvl <= 0) return 1;
		// each speed upgrade grants a multiplicative bonus; use smaller growth
		// to keep things balanced: 8% per upgrade compounded
		const mult = Math.pow(1.08, lvl);
		return mult;
	}

	// Refresh damage on any already-spawned balls so changes (like baseDamage edits)
	// take effect immediately without requiring a respawn.
	try{
		for(const b of activeBalls){
			if(b && b.type){
				b.damage = computeTypeDamage(b.type);
			}
		}
	}catch(e){}

	// build buy menu without descriptions (names + actions only)
	const helpBtn = document.getElementById('helpBtn');
	const helpMenu = document.getElementById('helpMenu');
	const settingsToggle = document.getElementById('settingsToggle');
	const settingsMenu = document.getElementById('settingsMenu');
	const upgradeBtn = document.getElementById('upgradeBtn');
	const upgradeMenu = document.getElementById('upgradeMenu');

	if(buyBtn && buyMenu){
	// --- Gem shop items & UI ---
	// Gem shop items (permanent upgrades and consumables purchasable with gems)
	const gemShopItems = [
		{
			id: 'crit',
			name: 'Critical Hits',
			cost: 12,
			type: 'permanent',
			maxStacks: 5,
			desc: 'Each level grants +5% chance for balls to deal double damage.'
		}
	];

	const gemBtn = document.getElementById('gemBtn');
	const gemMenu = document.getElementById('gemMenu');

	function renderGemMenu(){
		if(!gemMenu) return;
		// Only render items when the menu is actually open — keep inner HTML empty otherwise
		if(!gemMenu.classList.contains('show')){
			gemMenu.innerHTML = '';
			return;
		}
		if(!gemShopItems || gemShopItems.length === 0){
			gemMenu.innerHTML = '<div class="gem-empty" style="padding:8px;color:#cfe8ff">No gem shop items available.</div>';
			return;
		}
		let html = gemShopItems.map(it => {
			const owned = purchases[it.id] || 0;
			const curCost = (it.id === 'crit' && owned === 0) ? 3 : it.cost;
			let meta = '';
			if(it.type === 'permanent') meta = `Owned: ${owned}/${it.maxStacks || '∞'}`;
			if(it.type === 'consumable') meta = `Held: ${owned}`;
			if(it.type === 'cosmetic') meta = owned ? 'Owned' : '';
			const buyLabel = (it.type === 'consumable' && owned > 0) ? `Buy More ($${curCost})` : `Buy ($${curCost})`;
			const useBtn = (it.type === 'consumable' && owned > 0) ? `<button class="gem-use" data-id="${it.id}">Use</button>` : '';
			return `
				<div class="gem-item" data-id="${it.id}">
					<div class="gem-meta"><strong>${it.name}</strong><div style="font-size:11px;color:#cfe8ff;margin-top:4px">${it.desc} ${meta ? '<span style="margin-left:8px">' + meta + '</span>' : ''}</div></div>
					<div class="gem-actions">
							<button class="gem-buy" data-id="${it.id}" data-cost="${curCost}">${buyLabel}</button>
						${useBtn}
					</div>
				</div>`;
		}).join('');
		gemMenu.innerHTML = html;
	}

	if(gemBtn && gemMenu){
		gemBtn.addEventListener('click', (e)=>{
			e.stopPropagation();
			gemMenu.classList.toggle('show');
			gemMenu.setAttribute('aria-hidden', gemMenu.classList.contains('show') ? 'false' : 'true');
			// render items only when opening the menu
			renderGemMenu();
			// close other menus
			if(buyMenu && buyMenu.classList.contains('show')){ buyMenu.classList.remove('show'); buyMenu.setAttribute('aria-hidden','true'); }
			if(upgradeMenu && upgradeMenu.classList.contains('show')){ upgradeMenu.classList.remove('show'); upgradeMenu.setAttribute('aria-hidden','true'); }
		});
		renderGemMenu();
		gemMenu.addEventListener('click', (ev)=>{
			ev.stopPropagation();
			const btn = ev.target.closest('button');
			if(!btn) return;
			if(btn.classList.contains('gem-buy')){
				const id = btn.getAttribute('data-id');
				purchaseGemItem(id);
			}
			if(btn.classList.contains('gem-use')){
				const id = btn.getAttribute('data-id');
				useGemItem(id);
			}
		});
	}

	function purchaseGemItem(id){
			const it = gemShopItems.find(x => x.id === id);
			if(!it){ alert('Item not found'); return; }
			const cur = purchases[id] || 0;
			if(it.type === 'permanent' && typeof it.maxStacks === 'number' && cur >= it.maxStacks){
				alert('Already at max stacks for ' + it.name);
				return;
			}
			// allow special first-stack pricing for crit
			const curCost = (it.id === 'crit' && cur === 0) ? 3 : it.cost;
			if(gems < curCost){
				// show feedback
				showToast(`Not enough gems (need ${curCost})`, 2000);
				return;
			}
			// deduct and apply
			gems -= curCost;
			purchases[id] = (purchases[id] || 0) + 1;
			saveGame(); updateUI(); renderGemMenu();
			showToast(`Purchased ${it.name}`);
	}

	function useGemItem(id){
		const it = gemShopItems.find(x => x.id === id);
		if(!it){ alert('Item not found'); return; }
		if(it.type !== 'consumable'){ alert('This item is not a consumable.'); return; }
		const cur = purchases[id] || 0;
		if(cur <= 0){ alert('No items owned'); return; }
		// implement consumable effects here as needed
		purchases[id] = cur - 1;
		saveGame(); renderGemMenu(); updateUI();
	}

		function renderBuyMenu(){
			buyMenu.innerHTML = BALL_TYPES.map(t => {
				const lvl = upgrades[t.id] || 0;
				const upgradeCost = 50 * (lvl + 1);
				const curPrice = pricesByType[t.id] || t.price;
				return `
					<div class="ball-type" data-id="${t.id}">
						<div class="ball-meta"><strong>${t.name}</strong>
							<div class="owned">Owned: ${ballsByType[t.id] || 0}</div>
						</div>
						<div class="actions">
							<button class="buy-one" data-id="${t.id}" data-price="${curPrice}">Buy 1 ($${curPrice})</button>
							<button class="buy-max" data-id="${t.id}" data-price="${curPrice}">Buy Max</button>
							<button class="sell-one" data-id="${t.id}" data-price="${curPrice}">Sell 1 ($${Math.floor(curPrice*0.5)})</button>
							<button class="sell-all" data-id="${t.id}" data-price="${curPrice}">Sell All</button>

						</div>
					</div>`;
			}).join('');
		}
		renderBuyMenu();

		// render upgrades menu (separate UI) showing current levels and upgrade buttons
		function renderUpgradeMenu(){
			if(!upgradeMenu) return;
			// include a click-damage upgrade at the top
			const clickLvl = upgrades['click'] || 0;
			const clickCost = computeUpgradeCost('click');
			const clickDamage = 1 + clickLvl;
			let content = `
				<div class="upgrade-item" data-id="click">
					<div class="upgrade-meta"><strong>Click Damage</strong><div style="font-size:11px;color:#cfe8ff;margin-top:4px">Damage per click: ${clickDamage}</div></div>
					<div class="upgrade-actions">
						<button class="upgrade-click" data-id="click" data-cost="${clickCost}">Upgrade Click (+1) $${clickCost}</button>
					</div>
				</div>`;
			upgradeMenu.innerHTML = content + BALL_TYPES.map(t => {
				const lvl = upgrades[t.id] || 0;
				const upgradeCost = computeUpgradeCost(t.id);
				const damage = computeTypeDamage(t.id);
				// speed upgrade info
				const spKey = `${t.id}-speed`;
				const spLvl = upgrades[spKey] || 0;
				const spCost = computeUpgradeCost(spKey);
				const speedMult = computeTypeSpeed(t.id);
				return `
					<div class="upgrade-item" data-id="${t.id}">
						<div class="upgrade-meta"><strong>${t.name}</strong><div style="font-size:11px;color:#cfe8ff;margin-top:4px">Dmg: ${damage} — Speed: x${speedMult.toFixed(2)} — Owned: ${ballsByType[t.id] || 0}</div></div>
						<div class="upgrade-actions">
							<button class="upgrade-buy" data-id="${t.id}" data-cost="${upgradeCost}">Damage +1 $${upgradeCost}</button>
							<button class="upgrade-buy" data-id="${spKey}" data-cost="${spCost}">Speed +1 $${spCost}</button>
						</div>
					</div>`;
			}).join('');
		}
		renderUpgradeMenu();

		// toggle buy menu visibility
		buyBtn.addEventListener('click', (e)=>{
			e.stopPropagation();
			buyMenu.classList.toggle('show');
			buyMenu.setAttribute('aria-hidden', buyMenu.classList.contains('show') ? 'false' : 'true');
			// ensure help menu is closed when opening buy menu
			if(helpMenu && helpMenu.classList.contains('show')){
				helpMenu.classList.remove('show');
				helpMenu.setAttribute('aria-hidden','true');
			}
			// also close upgrades menu when opening buy menu
			if(upgradeMenu && upgradeMenu.classList.contains('show')){
				upgradeMenu.classList.remove('show');
				upgradeMenu.setAttribute('aria-hidden','true');
			}
			// also close gem menu when opening buy menu
			if(gemMenu && gemMenu.classList.contains('show')){ gemMenu.classList.remove('show'); gemMenu.setAttribute('aria-hidden','true'); }
		});

		// wire the upgrades dropdown toggle (next to buy menu)
		if(upgradeBtn && upgradeMenu){
			upgradeBtn.addEventListener('click', (e)=>{
				e.stopPropagation();
				upgradeMenu.classList.toggle('show');
				upgradeMenu.setAttribute('aria-hidden', upgradeMenu.classList.contains('show') ? 'false' : 'true');
				// close other menus
				if(buyMenu && buyMenu.classList.contains('show')){ buyMenu.classList.remove('show'); buyMenu.setAttribute('aria-hidden','true'); }
				if(helpMenu && helpMenu.classList.contains('show')){ helpMenu.classList.remove('show'); helpMenu.setAttribute('aria-hidden','true'); }
				// also close gem menu when opening upgrade menu
				if(gemMenu && gemMenu.classList.contains('show')){ gemMenu.classList.remove('show'); gemMenu.setAttribute('aria-hidden','true'); }
			});

			// clicks inside upgrade menu
			upgradeMenu.addEventListener('click', (ev)=>{
				ev.stopPropagation();
				const btn = ev.target.closest('button');
				if(!btn) return;
				if(btn.classList.contains('upgrade-buy')){
					const type = btn.getAttribute('data-id');
					purchaseUpgrade(type);
				}
				if(btn.classList.contains('upgrade-click')){
					// click-damage upgrade
					const curLvl = upgrades['click'] || 0;
					const cost = computeUpgradeCost('click');
					if(money < cost){ console.log('Not enough money to upgrade click'); return; }
					money -= cost;
					upgrades['click'] = curLvl + 1;
					saveGame();
					updateUI();
					if(typeof renderBuyMenu === 'function') renderBuyMenu();
					if(typeof renderUpgradeMenu === 'function') renderUpgradeMenu();
				}
			});
		}

		// centralized upgrade purchase helper used by buy menu and upgrades menu
		function purchaseUpgrade(type){
			const curLvl = upgrades[type] || 0;
			const curCost = computeUpgradeCost(type);
			if(money < curCost){ console.log('Not enough money to upgrade', type); return false; }
			money -= curCost;
			// if this is a speed upgrade key like 'sniper-speed', adjust existing balls' velocities
			if(typeof type === 'string' && type.endsWith('-speed')){
				const baseType = type.slice(0, -6);
				const oldMult = computeTypeSpeed(baseType);
				upgrades[type] = curLvl + 1;
				const newMult = computeTypeSpeed(baseType);
				// apply multiplier ratio to active balls of base type
				try{
					const ratio = (oldMult > 0) ? (newMult / oldMult) : newMult;
					for(const b of activeBalls){ if(b && b.type === baseType){ b.vx *= ratio; b.vy *= ratio; } }
				}catch(e){}
			} else {
				upgrades[type] = curLvl + 1;
			}
			saveGame();
			updateUI();
			if(typeof renderBuyMenu === 'function') renderBuyMenu();
			if(typeof renderUpgradeMenu === 'function') renderUpgradeMenu();
			// update currently active balls based on the upgrade applied
			try{
				if(typeof type === 'string' && type.endsWith('-speed')){
					// already handled velocity adjustments above, nothing more to do here
				} else {
					const newDamage = computeTypeDamage(type);
					for(const b of activeBalls){ if(b && b.type === type){ b.damage = newDamage; } }
				}
			}catch(e){/* ignore if activeBalls not ready */}
			return true;
		}

		// delegate clicks inside buy menu for buy-one and buy-max (use centralized purchase)
		buyMenu.addEventListener('click', (ev)=>{
			ev.stopPropagation();
			const btn = ev.target.closest('button');
			if(!btn) return;
			const type = btn.getAttribute('data-id');
			const price = parseInt(btn.getAttribute('data-price'), 10) || 0;
			if(btn.classList.contains('buy-one')){
				// attempt to purchase one of this type
				// do NOT close the menu after buying one so the player can buy multiple quickly
				if(purchaseBall(type, 1, price)){
					// scale the price for this type after a successful purchase
					const cur = pricesByType[type] || price || 1;
					pricesByType[type] = Math.max(1, Math.round(cur * 1.15));
					saveGame();
					renderBuyMenu();
				}
			} else if(btn.classList.contains('buy-max')){
				// compute buy max limited by funds and active-ball capacity
				const fundsMax = Math.floor(money / price);
				const available = Math.max(0, maxActiveBalls - countActiveCapacityUsed());
				const max = Math.min(fundsMax, available);
				if(max <= 0) { console.log('No funds or capacity to buy any', type); return; }
				if(purchaseBall(type, max, price)){
					// scale price according to number bought
					const cur = pricesByType[type] || price || 1;
					pricesByType[type] = Math.max(1, Math.round(cur * Math.pow(1.15, max)));
					saveGame();
					renderBuyMenu();
					buyMenu.classList.remove('show');
					buyMenu.setAttribute('aria-hidden', 'true');
				}
			} else if(btn.classList.contains('sell-one')){
				const typeDef = BALL_TYPES.find(t => t.id === type) || null;
				const curPrice = pricesByType[type] || (typeDef ? typeDef.price : 0);
				const sellUnit = curPrice ? Math.floor(curPrice * 0.5) : 0;
				if(sellUnit <= 0) { console.log('Cannot sell', type); return; }
				if(sellBall(type, 1, sellUnit)){
					updateUI();
					renderBuyMenu();
				}
			} else if(btn.classList.contains('sell-all')){
				const typeDef = BALL_TYPES.find(t => t.id === type) || null;
				const curPrice = pricesByType[type] || (typeDef ? typeDef.price : 0);
				const sellUnit = curPrice ? Math.floor(curPrice * 0.5) : 0;
				if(sellUnit <= 0) { console.log('Cannot sell', type); return; }
				const owned = ballsByType[type] || 0;
				if(owned <= 0) { console.log('No balls to sell', type); return; }
				sellBall(type, owned, sellUnit);
				// close menu after selling all
				buyMenu.classList.remove('show');
				buyMenu.setAttribute('aria-hidden','true');
			}
		});

	}

	// build help menu content (descriptions) and wire the help button
	if(helpBtn && helpMenu){
		helpMenu.innerHTML = BALL_TYPES.map(t => `
			<div class="help-item">
				<div class="name">${t.name}</div>
				<div class="desc">${t.desc}</div>
			</div>
		`).join('') + `<button class="help-close" id="helpClose">Close</button>`;

		// smart toggle: show below if it fits, else above, otherwise open as centered modal
		// open help as a centered modal; create a backdrop so it feels modal
		helpBtn.addEventListener('click', (e)=>{
			e.stopPropagation();

			// close buy menu when opening help
			if(buyMenu && buyMenu.classList.contains('show')){
				buyMenu.classList.remove('show');
				buyMenu.setAttribute('aria-hidden','true');
			}
			// close upgrades menu when opening help
			if(upgradeMenu && upgradeMenu.classList.contains('show')){
				upgradeMenu.classList.remove('show');
				upgradeMenu.setAttribute('aria-hidden','true');
			}

			// create backdrop
			let backdrop = document.getElementById('helpBackdrop');
			if(!backdrop){
				backdrop = document.createElement('div');
				backdrop.id = 'helpBackdrop';
				backdrop.className = 'help-backdrop';
				document.body.appendChild(backdrop);
			}
			// show modal and backdrop
			helpMenu.classList.add('modal','show');
			helpMenu.setAttribute('aria-hidden','false');
			backdrop.classList.add('show');

			// clicking backdrop closes the modal
			const closeHelp = ()=>{
				helpMenu.classList.remove('show','modal');
				helpMenu.setAttribute('aria-hidden','true');
				if(backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
			};
			backdrop.onclick = closeHelp;

			// wire close button
			const closeBtn = helpMenu.querySelector('#helpClose');
			if(closeBtn){
				closeBtn.onclick = closeHelp;
			}
		});
	}

		// Admin UI elements
		const adminBtn = document.getElementById('adminBtn');
		const adminModal = document.getElementById('adminModal');
		const adminPanel = document.getElementById('adminPanel');
		const adminPassInput = document.getElementById('adminPassInput');
		const adminPassOk = document.getElementById('adminPassOk');
		const adminPassClose = document.getElementById('adminPassClose');
		const adminClose = document.getElementById('adminClose');
		const adminSetMoney = document.getElementById('adminSetMoney');
		const adminSetLevel = document.getElementById('adminSetLevel');
		const adminSetMax = document.getElementById('adminSetMax');
		const adminClearSave = document.getElementById('adminClearSave');
		const adminMoney = document.getElementById('adminMoney');
		const adminLevel = document.getElementById('adminLevel');
		const adminMaxBalls = document.getElementById('adminMaxBalls');
		const adminForceCritEl = document.getElementById('adminForceCrit');

		// open password modal
		if(adminBtn && adminModal){
			adminBtn.addEventListener('click', (e)=>{
				e.stopPropagation();
				adminModal.classList.add('show');
				adminModal.setAttribute('aria-hidden','false');
				adminPassInput.value = '';
				adminPassInput.focus();
				// close other menus
				if(buyMenu && buyMenu.classList.contains('show')){ buyMenu.classList.remove('show'); buyMenu.setAttribute('aria-hidden','true'); }
				if(upgradeMenu && upgradeMenu.classList.contains('show')){ upgradeMenu.classList.remove('show'); upgradeMenu.setAttribute('aria-hidden','true'); }
				if(helpMenu && helpMenu.classList.contains('show')){ helpMenu.classList.remove('show'); helpMenu.setAttribute('aria-hidden','true'); }
			});
		}

		function closeAdminModal(){
			if(adminModal) { adminModal.classList.remove('show'); adminModal.setAttribute('aria-hidden','true'); }
		}
		function openAdminPanel(){
			if(!adminPanel) return;
			adminPanel.classList.add('show'); adminPanel.setAttribute('aria-hidden','false');
			// populate fields with current values
			if(adminMoney) adminMoney.value = money;
			if(adminLevel) adminLevel.value = level;
			if(adminMaxBalls) adminMaxBalls.value = maxActiveBalls;
			if(adminForceCritEl) adminForceCritEl.checked = !!adminForceFullCrit;
		}

		if(adminPassClose) adminPassClose.addEventListener('click', closeAdminModal);
		if(adminPassOk){
			adminPassOk.addEventListener('click', ()=>{
				const val = (adminPassInput && adminPassInput.value) ? adminPassInput.value.trim() : '';
				if(val === '2005'){
					closeAdminModal();
					openAdminPanel();
				} else {
					alert('Incorrect admin password');
				}
			});
		}

		if(adminClose) adminClose.addEventListener('click', ()=>{ if(adminPanel){ adminPanel.classList.remove('show'); adminPanel.setAttribute('aria-hidden','true'); } });

		if(adminSetMoney){
			adminSetMoney.addEventListener('click', ()=>{
				const v = parseInt(adminMoney.value, 10) || 0;
				money = v;
				saveGame(); updateUI();
				alert('Money set to $' + money);
			});
		}

		if(adminSetLevel){
			adminSetLevel.addEventListener('click', ()=>{
				const v = Math.max(1, parseInt(adminLevel.value, 10) || 1);
				level = v;
				initBricks(level);
				saveGame(); updateUI();
				alert('Level set to ' + level);
			});
		}

		if(adminSetMax){
			adminSetMax.addEventListener('click', ()=>{
				const v = Math.max(1, parseInt(adminMaxBalls.value, 10) || 1);
				maxActiveBalls = v;
				saveGame(); updateUI();
				alert('Max active balls set to ' + maxActiveBalls);
			});
		}

		if(adminForceCritEl){
			adminForceCritEl.addEventListener('change', ()=>{
				adminForceFullCrit = !!adminForceCritEl.checked;
				try{ localStorage.setItem('bb-admin-forceCrit', adminForceFullCrit ? '1' : '0'); }catch(e){}
				showToast('100% Crit ' + (adminForceFullCrit ? 'Enabled' : 'Disabled'));
			});
		}

		if(adminClearSave){
			adminClearSave.addEventListener('click', ()=>{
				if(confirm('Clear all saved game data? This cannot be undone.')){
					localStorage.removeItem('brickbreaker-save');
					localStorage.removeItem('brickbreaker-seen');
					// reload to ensure a clean state
					alert('Save cleared — game will reload');
					location.reload();
				}
			});
		}

	// Rebirth handling: cost, effects, and UI
	const REBIRTH_COST = 50000; // cost in money to rebirth
	const REBIRTH_BALL_BONUS = 10; // add this many standard balls on rebirth
	const REBIRTH_MAXBALLS_BONUS = 5; // increase max active balls per rebirth

	function canRebirth(){
		return money >= REBIRTH_COST;
	}

	function doRebirth(){
		if(!canRebirth()) { console.log('Not enough money to rebirth'); return false; }
		if(!confirm(`Rebirth will cost $${REBIRTH_COST}. You will reset progress, gain +${REBIRTH_MAXBALLS_BONUS} max balls, and 1 Gem. Proceed?`)) return false;
		// Deduct cost, increment rebirth count and award gems
		money -= REBIRTH_COST;
		rebirths += 1;
		gems += 1;
		// Reset owned balls and upgrades to ensure a fresh start
		try{
			// clear any existing upgrade entries (handles keys like '<type>-speed')
			for(const k of Object.keys(upgrades)) delete upgrades[k];
			// reinitialize canonical upgrade slots to zero for every ball type
			for(const t of BALL_TYPES){
				upgrades[t.id] = 0;
				upgrades[`${t.id}-speed`] = 0;
			}
			// always clear click upgrade
			upgrades['click'] = 0;
			// clear inventory for all known types and reset owned inventory
			for(const t of BALL_TYPES){ ballsByType[t.id] = 0; }
			ballsOwned = 0;
			// reset per-type buy prices back to their base values so the shop reflects owning none
			for(const t of BALL_TYPES) pricesByType[t.id] = t.price;
			// do NOT grant starter standard balls on rebirth; only increase max active balls
			maxActiveBalls += REBIRTH_MAXBALLS_BONUS;
		}catch(e){
			// fallback: ensure owned reset and max active balls increased
			ballsOwned = 0;
			maxActiveBalls += REBIRTH_MAXBALLS_BONUS;
		}
		// reset level and recreate bricks (keep rebirth benefits and gems)
		activeBalls.length = 0;
		level = 1;
		// clear boss state and any pending level transition so rebirth truly resets progression
		try{ boss = null; bossTimer = 0; }catch(e){}
		try{ levelTransition.active = false; levelTransition.nextLevel = null; levelTransition.start = 0; }catch(e){}
		// reset money to starting amount on rebirth
		try{ money = START_MONEY; }catch(e){ money = 0; }
		initBricks(level);
		saveGame();
		updateUI();
		// refresh shop and upgrade menus so their displayed owned/level values update
		try{
			if(typeof renderBuyMenu === 'function') renderBuyMenu();
		}catch(e){}
		try{
			if(typeof renderUpgradeMenu === 'function') renderUpgradeMenu();
		}catch(e){}
		try{ if(typeof renderGemMenu === 'function') renderGemMenu(); }catch(e){}
		console.log('Rebirth complete. Total rebirths:', rebirths);
		return true;
	}

	// wire rebirth button if present
	const rebirthBtn = document.getElementById('rebirthBtn');
	if(rebirthBtn){
		// remember original background to restore after error flash
		let _origRebirthBg = rebirthBtn.style.background || window.getComputedStyle(rebirthBtn).background;
		let _origRebirthBox = rebirthBtn.style.boxShadow || window.getComputedStyle(rebirthBtn).boxShadow;

		rebirthBtn.addEventListener('click', ()=>{
			if(canRebirth()){
				doRebirth();
			} else {
				// visual feedback: shake and flash red
				rebirthBtn.classList.add('shake');
				try{ rebirthBtn.style.background = '#ef4444'; rebirthBtn.style.boxShadow = '0 6px 18px rgba(239,68,68,0.25)'; }catch(e){}
				setTimeout(()=>{ try{ rebirthBtn.classList.remove('shake'); }catch(e){} }, 420);
				setTimeout(()=>{ try{ rebirthBtn.style.background = _origRebirthBg; rebirthBtn.style.boxShadow = _origRebirthBox; }catch(e){} }, 700);
				// optional audio feedback
				try{ if(window._sounds && window._sounds.setEnabled && window._sounds.enabled && !window._sounds.enabled()){} }catch(e){}
			}
			// update button label to reflect cost (in case things changed)
			rebirthBtn.textContent = `Rebirth ($${REBIRTH_COST})`;
		});
		// show initial label
		rebirthBtn.textContent = `Rebirth ($${REBIRTH_COST})`;
	}

	// close menus when clicking outside (applies to buyMenu)
	document.addEventListener('click', ()=>{
		if(buyMenu && buyMenu.classList.contains('show')){
			buyMenu.classList.remove('show');
			buyMenu.setAttribute('aria-hidden', 'true');
		}
		if(upgradeMenu && upgradeMenu.classList.contains('show')){
			upgradeMenu.classList.remove('show');
			upgradeMenu.setAttribute('aria-hidden', 'true');
		}
		if(gemMenu && gemMenu.classList.contains('show')){
			gemMenu.classList.remove('show');
			gemMenu.setAttribute('aria-hidden', 'true');
		}
		if(settingsMenu && settingsMenu.classList.contains('show')){
			settingsMenu.classList.remove('show');
			settingsMenu.setAttribute('aria-hidden','true');
		}
		// if helpMenu is shown as modal, clicking outside will be handled by the backdrop,
		// otherwise ensure helpMenu is closed if it's open and no backdrop exists
		if(helpMenu && helpMenu.classList.contains('show')){
			const bd = document.getElementById('helpBackdrop');
			if(!bd){
				helpMenu.classList.remove('show');
				helpMenu.setAttribute('aria-hidden', 'true');
			}
		}
	});

	// Settings toggle behavior (show/hide the bottom-right settings menu)
	if(settingsToggle && settingsMenu){
		settingsToggle.addEventListener('click', (e)=>{
			e.stopPropagation();
			const isNow = settingsMenu.classList.toggle('show');
			settingsMenu.setAttribute('aria-hidden', isNow ? 'false' : 'true');
			// ensure other menus are closed
			if(buyMenu && buyMenu.classList.contains('show')){ buyMenu.classList.remove('show'); buyMenu.setAttribute('aria-hidden','true'); }
			if(upgradeMenu && upgradeMenu.classList.contains('show')){ upgradeMenu.classList.remove('show'); upgradeMenu.setAttribute('aria-hidden','true'); }
			if(helpMenu && helpMenu.classList.contains('show')){ helpMenu.classList.remove('show'); helpMenu.setAttribute('aria-hidden','true'); }
		});
	}

// Theme handling: cycle and persist theme choice
(function(){
	const themeBtn = document.getElementById('themeBtn');
	const themeLabel = document.getElementById('themeLabel');
	const available = ['christmas','dark','retro'];
	function applyTheme(t){
		const theme = t; // explicit theme name (e.g., 'christmas', 'dark')
		try{ if(theme) document.body.setAttribute('data-theme', theme); else document.body.removeAttribute('data-theme'); }catch(e){}
		try{ localStorage.setItem('bb-theme', t); }catch(e){}
		if(themeLabel) themeLabel.textContent = (t === 'christmas') ? 'Christmas' : (t.charAt(0).toUpperCase() + t.slice(1));
		// Show snow only for the Christmas theme. When enabling, fit/init
		// the snow canvas; when disabling, clear the particles and hide the canvas.
		try{
			if(typeof snowCanvas !== 'undefined' && snowCanvas){
				if(t === 'christmas'){
					snowCanvas.style.display = 'block';
					fitSnowCanvas();
					if(Array.isArray(snowParticles) && snowParticles.length === 0) initSnow(120);
				} else {
					snowCanvas.style.display = 'none';
					if(snowCtx && snowCanvas) snowCtx.clearRect(0,0,snowCanvas.clientWidth || 0, snowCanvas.clientHeight || 0);
					if(Array.isArray(snowParticles)) snowParticles.length = 0;
				}
			}
		}catch(e){}
	}
	// initialize (default to 'dark')
	try{
		const saved = (localStorage.getItem && localStorage.getItem('bb-theme')) || 'dark';
		applyTheme(saved);
	}catch(e){ applyTheme('dark'); }
	if(themeBtn){
		// open centered theme modal instead of cycling
		themeBtn.addEventListener('click', (e)=>{
			e.stopPropagation();
			const modal = document.getElementById('themeModal');
			const opts = document.getElementById('themeOptions');
			if(!modal || !opts) return;
			// render options
			opts.innerHTML = '';
			available.forEach(t => {
				const label = (t === 'dark') ? 'Dark (Default)' : (t.charAt(0).toUpperCase() + t.slice(1));
				const btn = document.createElement('button');
				btn.textContent = label;
				btn.style.padding = '10px 12px';
				btn.style.borderRadius = '8px';
				btn.style.border = '0';
				btn.style.cursor = 'pointer';
				btn.style.textAlign = 'left';
				btn.dataset.theme = t;
				// highlight current
				const cur = (localStorage.getItem && localStorage.getItem('bb-theme')) || 'default';
				if(cur === t){ btn.style.outline = '2px solid rgba(255,255,255,0.08)'; }
				btn.addEventListener('click', ()=>{ applyTheme(t); closeThemeModal(); });
				opts.appendChild(btn);
			});
			// show modal
			modal.style.display = 'flex';
			modal.setAttribute('aria-hidden', 'false');
		});
	}

	// Theme modal close handling
	function closeThemeModal(){
		const modal = document.getElementById('themeModal');
		if(!modal) return;
		modal.style.display = 'none';
		modal.setAttribute('aria-hidden','true');
	}
	const themeClose = document.getElementById('themeClose');
	if(themeClose) themeClose.addEventListener('click', closeThemeModal);
	// close modal when clicking backdrop
	const themeModal = document.getElementById('themeModal');
	if(themeModal){
		themeModal.addEventListener('click', (ev)=>{
			if(ev.target === themeModal) closeThemeModal();
		});
	}
	// escape key closes modal
	window.addEventListener('keydown', (ev)=>{ if(ev.key === 'Escape') closeThemeModal(); });
})();

	function releaseBalls(){
		if(ballsOwned <= 0) return;
		const n = ballsOwned;
		for(let i=0;i<n;i++){
			const spread = (i - (n-1)/2) * 3; // small horizontal spread
			// convert initial per-frame velocity values to pixels-per-second (multiply by 60)
			let rvx = ((Math.random()-0.5)*1.2 + spread*0.03) * 60;
			let rvy = (-3.5 - Math.random()*1.2) * 60;
			// apply standard speed upgrades
			try{ const sp = computeTypeSpeed('standard'); rvx *= sp; rvy *= sp; }catch(e){}
			activeBalls.push({
				x: GAME.width/2 + spread,
				y: GAME.height - 28,
				vx: rvx,
				vy: rvy,
				r:6,
				alive:true,
				type: 'standard',
				damage: computeTypeDamage('standard')
			});
		}
		// ensure children flags unaffected; no extra work here
		ballsOwned = 0;
		updateUI();
	}

	// helper to spawn a ball of a given type into the activeBalls array
	// optional x,y allow placing the ball at a specific position
function spawnBall(type = 'standard', x = null, y = null){
		let vx = (Math.random()-0.5)*1.2;
		let vy = -3.5 - Math.random()*1.2;
		let r = 6;
		// type-specific tweaks
		switch(type){
			case 'heavy':
				r = 8;
				vx *= 0.6;
				vy *= 0.6;
				break;
			case 'sniper':
				// sniper: smaller radius, slightly faster, will auto-target nearest brick
				r = 5;
				vx *= 1.1;
				vy *= 1.1;
				break;
			default:
				// standard
		}
		// convert to pixels-per-second (velocities were authored as per-frame values)
		vx *= 60;
		vy *= 60;
		// apply speed upgrades multiplier
		try{ const sp = computeTypeSpeed(type); vx *= sp; vy *= sp; }catch(e){}

		// determine damage using centralized computation (includes baseDamage and scaled upgrades)
		const damage = computeTypeDamage(type);
		const ballObj = {
			x: typeof x === 'number' ? x : (GAME.width/2 + (Math.random()-0.5)*20),
			y: typeof y === 'number' ? y : (GAME.height - 28),
			vx,
			vy,
			r,
			alive:true,
			type,
			damage
		};

		// Scatter-specific: children bypass capacity; init last spawn timestamp
		if(type === 'scatter'){
			ballObj._lastScatterSpawn = 0;
			// track how many mini-children this parent has produced
			ballObj._scatterChildrenSpawned = 0;
		}
		// sniper-specific state: must hit a brick, then hit a wall to re-target
		if(type === 'sniper'){
			ballObj.sniperCanRetarget = true; // initially can target
			ballObj.sniperHitBrick = false; // set true when it collides with a brick
		}
		activeBalls.push(ballObj);

		return ballObj;
	}

	// Spawn smaller child balls for a scatter parent. Children bypass the active-ball
	// capacity and are marked so they are destroyed at level transition.
	function spawnScatterChildren(parent){
		if(!parent) return;
		const now = performance.now ? performance.now() : Date.now();
		// prevent immediate repeated spawns from the same collision (cooldown 150ms)
		if(parent._lastScatterSpawn && (now - parent._lastScatterSpawn) < 150) return;
		const DEFAULT_SPAWN_COUNT = 2; // number of fragments to spawn per event
		const MAX_CHILDREN_PER_PARENT = 10; // cap per scatter parent
		// enforce per-parent cap (cumulative spawned children)
		const spawnedSoFar = parent._scatterChildrenSpawned || 0;
		const availableForParent = Math.max(0, MAX_CHILDREN_PER_PARENT - spawnedSoFar);
		const toSpawn = Math.min(DEFAULT_SPAWN_COUNT, availableForParent);
		if(toSpawn <= 0) return; // this parent already spawned its quota
		const parentSpeed = Math.hypot(parent.vx || 0, parent.vy || 0) || 180;
		const baseDamage = (typeof parent.damage === 'number') ? parent.damage : computeTypeDamage('scatter');
		const childDamage = baseDamage * 0.25;
		for(let k=0;k<toSpawn;k++){
			// fully random direction for each child
			const angle = Math.random() * Math.PI * 2;
			const speed = parentSpeed * (0.6 + Math.random() * 0.6);
			const vx = Math.cos(angle) * speed;
			const vy = Math.sin(angle) * speed;
			activeBalls.push({
				x: parent.x,
				y: parent.y,
				vx,
				vy,
				r: 3,
				alive: true,
				type: 'scatterChild',
				damage: childDamage,
				isScatterChild: true
			});
			// increment parent's spawned counter
			parent._scatterChildrenSpawned = (parent._scatterChildrenSpawned || 0) + 1;
		}
		parent._lastScatterSpawn = now;
	}

	// reset game to initial state
	function resetGame(){
		// restore defaults
		money = START_MONEY;
		ballPrice = START_BALL_PRICE;
		ballsOwned = 0;
		// clear active balls
		activeBalls.length = 0;
		// re-create bricks
		level = 1;
		initBricks(level);

		// reset purchased balls inventory to zero for all types
		try{
			for(const k of Object.keys(ballsByType)) delete ballsByType[k];
			for(const t of BALL_TYPES) ballsByType[t.id] = 0;
		} catch(e) { /* ignore if BALL_TYPES not available yet */ }

		// reset per-type buy prices back to their base values so the shop reflects owning none
		try{
			for(const t of BALL_TYPES) pricesByType[t.id] = t.price;
		} catch(e) { /* ignore if BALL_TYPES not available yet */ }

		// reset upgrades (damage levels) to zero for all types
		try{
			// clear any existing upgrade entries (handles newly added keys like '<type>-speed')
			for(const k of Object.keys(upgrades)) delete upgrades[k];
			// reinitialize canonical upgrade keys to zero
			for(const t of BALL_TYPES) {
				upgrades[t.id] = 0;
				// also initialize speed upgrade slot explicitly
				upgrades[`${t.id}-speed`] = 0;
			}
			// also clear click upgrade
			upgrades['click'] = 0;
		} catch(e) { /* ignore if BALL_TYPES not available yet */ }

		// reset prestige / rebirth state and gems
		try{
			rebirths = 0;
			gems = 0;
		} catch(e) { /* ignore if variables not available yet */ }
		// close buy menu if open
		if(buyMenu && buyMenu.classList.contains('show')){
			buyMenu.classList.remove('show');
			buyMenu.setAttribute('aria-hidden', 'true');
		}

		// ensure UI and buy menu reflect cleared ownership immediately
		try{
			updateUI();
			// restore admin-set values to defaults
			maxActiveBalls = DEFAULT_MAX_ACTIVE_BALLS;
			if(typeof renderBuyMenu === 'function' && buyMenu) renderBuyMenu();
			if(typeof renderUpgradeMenu === 'function' && upgradeMenu) renderUpgradeMenu();
		} catch(e) { /* ignore if UI not ready yet */ }
		// persist cleared state so reload won't restore purchased balls
		try{
			// mark that the game has been seen so we don't re-spawn defaults
			localStorage.setItem('brickbreaker-seen','1');
			saveGame();
			// also remove any old save key to avoid confusion (saveGame wrote cleared state)
			localStorage.removeItem('brickbreaker-save-legacy');
		} catch(e){}
		// reset cursor and UI
		if(canvas) canvas.style.cursor = 'default';
		updateUI();
		// draw immediately so user sees reset state
		draw();
	}

	// Wire reset button to show confirmation modal that requires typing CONFIRM
	if(resetBtn){
		resetBtn.addEventListener('click', (e)=>{
			e.stopPropagation();
			const modal = document.getElementById('resetConfirmModal');
			const input = document.getElementById('resetConfirmInput');
			if(modal){
				modal.style.display = 'flex';
				modal.setAttribute('aria-hidden','false');
				input.value = '';
				// clear any previous hint/animation
				try{ clearResetHint(); }catch(e){}
				setTimeout(()=>{ input.focus(); }, 30);
			} else {
				// fallback: if modal not present, perform reset immediately
				resetGame();
			}
		});
	}

	// Modal buttons
	const resetConfirmOk = document.getElementById('resetConfirmOk');
	const resetConfirmCancel = document.getElementById('resetConfirmCancel');
	const resetConfirmModal = document.getElementById('resetConfirmModal');
	const resetConfirmInput = document.getElementById('resetConfirmInput');
	const resetConfirmHint = document.getElementById('resetConfirmHint');
	function showResetFailed(){
		try{
			if(resetConfirmHint) resetConfirmHint.classList.add('show');
			if(resetConfirmInput){
				resetConfirmInput.classList.remove('shake');
				// trigger reflow to restart animation
				void resetConfirmInput.offsetWidth;
				resetConfirmInput.classList.add('shake');
				resetConfirmInput.focus();
			}
		}catch(e){}
	}
	function clearResetHint(){ if(resetConfirmHint) resetConfirmHint.classList.remove('show'); if(resetConfirmInput) resetConfirmInput.classList.remove('shake'); }
	function hideResetModal(){
		if(resetConfirmModal){ resetConfirmModal.style.display = 'none'; resetConfirmModal.setAttribute('aria-hidden','true'); }
		clearResetHint();
	}
	if(resetConfirmCancel) resetConfirmCancel.addEventListener('click', (ev)=>{ ev.stopPropagation(); hideResetModal(); });
	if(resetConfirmOk){ resetConfirmOk.addEventListener('click', (ev)=>{ ev.stopPropagation(); if(resetConfirmInput && resetConfirmInput.value === 'CONFIRM'){ hideResetModal(); resetGame(); } else { showResetFailed(); } }); }
	if(resetConfirmInput){
		resetConfirmInput.addEventListener('keydown', (ev)=>{
			if(ev.key === 'Enter'){
				ev.preventDefault();
				if(resetConfirmInput.value === 'CONFIRM'){
					hideResetModal();
					resetGame();
				} else {
					showResetFailed();
				}
			}
		});
	}
	// remove shake class after animation completes so it can be re-triggered
	if(resetConfirmInput){
		resetConfirmInput.addEventListener('animationend', ()=>{ if(resetConfirmInput) resetConfirmInput.classList.remove('shake'); });
	}

		// allow clicking canvas to break bricks (award money). If no brick was clicked, release a test ball.
		canvas.addEventListener('click', (e) => {
		if(levelTransition.active) return; // ignore clicks during level transition
		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;
			// check boss first if present
			if(boss && boss.alive){
				const dx = mx - boss.x;
				const dy = my - boss.y;
				if((dx*dx + dy*dy) <= (boss.r * boss.r)){
					const clickDmg = 1 + (upgrades['click'] || 0);
					applyDamageToBoss(clickDmg);
					return;
				}
			}
			// check bricks (top-to-bottom isn't necessary but iterate normally)
		for(let i=0;i<bricks.length;i++){
			const br = bricks[i];
			if(!br.alive) continue;
			if(mx >= br.x && mx <= br.x + br.w && my >= br.y && my <= br.y + br.h){
				// clicking applies base 1 damage + click-upgrades
				const clickDmg = 1 + (upgrades['click'] || 0);
				applyDamageToBrick(br, clickDmg);
				return; // stop here, do not spawn a test ball
			}
		}
		// clicked empty space — do nothing (no test ball spawn)
	});

	// change cursor when hovering over clickable bricks
	canvas.addEventListener('mousemove', (e) => {
		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;
		let over = false;
		for(const br of bricks){
			if(!br.alive) continue;
			if(mx >= br.x && mx <= br.x + br.w && my >= br.y && my <= br.y + br.h){ over = true; break; }
		}
		canvas.style.cursor = over ? 'pointer' : 'default';
	});

	function circleRectCollision(ball, rect){
		const nearestX = Math.max(rect.x, Math.min(ball.x, rect.x + rect.w));
		const nearestY = Math.max(rect.y, Math.min(ball.y, rect.y + rect.h));
		const dx = ball.x - nearestX;
		const dy = ball.y - nearestY;
		return (dx*dx + dy*dy) <= (ball.r * ball.r);
	}

	// Main loop
	// Make balls "float" by disabling gravity and using fully elastic bounces.
	const gravity = 0; // no gravity so balls float around
	const bounce = 1.0; // fully elastic collisions to preserve speed

	function update(dt){
		// update snow (use snowCanvas dimensions when available)
		const sw = (snowCanvas && snowCanvas.clientWidth) ? snowCanvas.clientWidth : GAME.width;
		const sh = (snowCanvas && snowCanvas.clientHeight) ? snowCanvas.clientHeight : GAME.height;
		for(const p of snowParticles){
			p.y += p.speed * dt;
			p.x += Math.sin(p.y * 0.01) * p.drift * dt;
			if(p.y - p.r > sh){ p.y = -p.r; p.x = Math.random()*sw; }
			if(p.x < -10) p.x = sw + 10;
			if(p.x > sw + 10) p.x = -10;
		}
		// update crit bubbles
		for(let i = critBubbles.length - 1; i >= 0; i--){
			const cb = critBubbles[i];
			cb.t += dt;
			cb.y += cb.vy * dt;
			// slight upward deceleration
			cb.vy += 40 * dt;
			if(cb.t >= cb.ttl) critBubbles.splice(i,1);
		}
		// update balls
		for(let i = activeBalls.length-1; i>=0; i--){
			const b = activeBalls[i];
			// if boss exists and is alive, check circle-circle collision with balls first
			// Allow scatter child balls to hit the boss as well.
			if(boss && boss.alive && b){
				const dx = b.x - boss.x;
				const dy = b.y - boss.y;
				const dist2 = dx*dx + dy*dy;
				const minDist = (b.r || 0) + boss.r;
				if(dist2 <= (minDist * minDist)){
						// collision: apply damage to boss
						const damage = (typeof b.damage === 'number' && b.damage > 0) ? b.damage : 1;
						applyDamageToBoss(damage);
						// compute normal from boss center to ball
						const dist = Math.sqrt(dist2) || 0.0001;
						const nx = dx / dist;
						const ny = dy / dist;
						// reflect velocity across normal: r = v - 2*(v·n)*n
						const vdot = (b.vx * nx) + (b.vy * ny);
						let rx = b.vx - 2 * vdot * nx;
						let ry = b.vy - 2 * vdot * ny;
						// preserve overall speed magnitude (avoid slowing too much)
						const oldSpeed = Math.hypot(b.vx, b.vy) || 4;
						const newSpeed = Math.hypot(rx, ry) || 0.0001;
						rx = (rx / newSpeed) * oldSpeed;
						ry = (ry / newSpeed) * oldSpeed;
						// small random tangential nudge to avoid perfectly repeating paths
						const tangentNudge = (Math.random() - 0.5) * 0.25;
						rx += -ny * tangentNudge;
						ry += nx * tangentNudge;
						b.vx = rx * bounce;
						b.vy = ry * bounce;
						// push the ball out of the boss to avoid sticking (resolve penetration)
						const overlap = Math.max(0, minDist - dist);
						const push = overlap + 0.6; // extra padding to ensure separation
						b.x += nx * push;
						b.y += ny * push;
						// continue to next ball (skip brick checks)
						continue;
				}
			}
			// Sniper balls auto-target the nearest alive brick by steering their velocity
			if(b && b.type === 'sniper' && b.sniperCanRetarget){
				let best = Infinity;
				let targetDx = 0, targetDy = 0;
				for(const br of bricks){
					if(!br.alive) continue;
					const bx = br.x + br.w/2;
					const by = br.y + br.h/2;
					const dx = bx - b.x;
					const dy = by - b.y;
					const d2 = dx*dx + dy*dy;
					if(d2 < best){ best = d2; targetDx = dx; targetDy = dy; }
				}
				if(best < Infinity){
					const speed = Math.hypot(b.vx, b.vy) || 3.5;
					const dist = Math.sqrt(best) || 1;
					b.vx = (targetDx / dist) * speed;
					b.vy = (targetDy / dist) * speed;
				}
			}
			// integrate velocities (velocities are pixels-per-second)
			b.vy += gravity * dt;
			b.x += b.vx * dt;
			b.y += b.vy * dt;

			// wall collisions
					if(b.x - b.r < 0){
						b.x = b.r;
						b.vx = -b.vx * bounce;
						if(b.type === 'sniper'){
							b.sniperCanRetarget = true;
							b.sniperHitBrick = false;
							if(boss && boss.alive){
								const dx = (boss.x) - b.x;
								const dy = (boss.y) - b.y;
								const dist = Math.hypot(dx, dy) || 1;
								const speed = Math.hypot(b.vx, b.vy) || 3.5;
								b.vx = (dx/dist) * speed;
								b.vy = (dy/dist) * speed;
							}
						}
						// scatter: spawn children when the scatter ball hits a wall
						if(b.type === 'scatter'){ spawnScatterChildren(b); }
					}
					if(b.x + b.r > GAME.width){
						b.x = GAME.width - b.r;
						b.vx = -b.vx * bounce;
						if(b.type === 'sniper'){
							b.sniperCanRetarget = true;
							b.sniperHitBrick = false;
							if(boss && boss.alive){
								const dx = (boss.x) - b.x;
								const dy = (boss.y) - b.y;
								const dist = Math.hypot(dx, dy) || 1;
								const speed = Math.hypot(b.vx, b.vy) || 3.5;
								b.vx = (dx/dist) * speed;
								b.vy = (dy/dist) * speed;
							}
						}
						if(b.type === 'scatter'){ spawnScatterChildren(b); }
					}
					if(b.y - b.r < 0){
						b.y = b.r;
						b.vy = -b.vy * bounce;
						if(b.type === 'sniper'){
							b.sniperCanRetarget = true;
							b.sniperHitBrick = false;
							if(boss && boss.alive){
								const dx = (boss.x) - b.x;
								const dy = (boss.y) - b.y;
								const dist = Math.hypot(dx, dy) || 1;
								const speed = Math.hypot(b.vx, b.vy) || 3.5;
								b.vx = (dx/dist) * speed;
								b.vy = (dy/dist) * speed;
							}
						}
						if(b.type === 'scatter'){ spawnScatterChildren(b); }
					}

					// floor: bounce off bottom so balls stay inside the level
					if (b.y + b.r > GAME.height) {
						// push back to the surface and reflect velocity (no friction)
						b.y = GAME.height - b.r;
						b.vy = -b.vy * bounce;
					}

			// brick collisions
			for(let j=0;j<bricks.length;j++){
				const br = bricks[j];
				if(!br.alive) continue;
				if(circleRectCollision(b, br)){
					// determine damage from this ball
					const damage = (typeof b.damage === 'number' && b.damage > 0) ? b.damage : 1;
					// preserve ball speed but perturb direction slightly so balls keep moving
					const speed = Math.hypot(b.vx, b.vy) || 4;
					let angle = Math.atan2(b.vy, b.vx);
					angle = -angle + (Math.random() - 0.5) * 0.3;
					b.vx = Math.cos(angle) * speed;
					b.vy = Math.sin(angle) * speed;
					// apply damage (may be >1) and let helper manage awards & level progression
					applyDamageToBrick(br, damage);
						// scatter: spawn children on brick hit
						if(b && b.type === 'scatter'){
							spawnScatterChildren(b);
						}
					// sniper-specific rule: after hitting a brick, the sniper must hit a wall
					// before it is allowed to retarget again
					if(b.type === 'sniper'){
						b.sniperHitBrick = true;
						b.sniperCanRetarget = false;
					}
					break;
				}
			}
		}

		// boss timer handling
		if(boss && boss.alive){
			bossTimer -= dt;
			if(bossTimer <= 0){
				// boss timeout: revert to previous level and award partial money
				const prev = Math.max(1, level - 1);
				const award = boss && boss.maxValue ? Math.floor(boss.maxValue * 0.5) : 0;
				money += award;
				console.log('Boss timeout: awarding $' + award + ' and reverting to level', prev);
				level = prev;
				initBricks(level);
				saveGame(); updateUI();
				// clear boss state
				boss = null; bossTimer = 0;
			}
		}
	}

	function draw(){
		ctx.clearRect(0,0,GAME.width,GAME.height);

		// draw boss UI/timer if present
		if(boss && boss.alive){
			// boss circle
			ctx.save();
			ctx.shadowColor = 'rgba(255,100,100,0.25)';
			ctx.shadowBlur = 18;
			ctx.fillStyle = '#ff9b9b';
			ctx.beginPath();
			ctx.arc(boss.x, boss.y, boss.r, 0, Math.PI*2);
			ctx.fill();
			ctx.restore();
			// boss hp text
			ctx.fillStyle = '#fff';
			ctx.font = '16px system-ui,Segoe UI,Roboto';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(`Boss HP: ${boss.value}`, boss.x, boss.y);
			// timer in top center
			ctx.fillStyle = '#ffdede';
			ctx.font = '14px system-ui,Segoe UI,Roboto';
			ctx.textAlign = 'center';
			ctx.fillText(`Time: ${Math.max(0, Math.ceil(bossTimer))}s`, GAME.width/2, 22);
		}

		// draw bricks
		for(const br of bricks){
			if(!br.alive) continue;
			// color based on y position (keeps previous logic)
			const hue = 200 - Math.floor((br.y / GAME.height) * 80);
			const fill = 'hsl(' + hue + ', 80%, 55%)';
			// glow effect: use a soft cyan/pink glow for neon arcade
			ctx.save();
			ctx.shadowColor = 'rgba(50,240,255,0.18)';
			ctx.shadowBlur = 8;
			ctx.fillStyle = fill;
			ctx.fillRect(br.x, br.y, br.w, br.h);
			ctx.restore();
			// outline without glow for crisp edge
			ctx.lineWidth = 2;
			ctx.strokeStyle = 'rgba(255,255,255,0.12)';
			ctx.strokeRect(br.x + 0.5, br.y + 0.5, br.w - 1, br.h - 1);

			// draw the value on the front of the brick (centered)
			ctx.save();
			const fontSize = Math.max(10, Math.min(br.h - 6, 16));
			ctx.font = `${fontSize}px system-ui,Segoe UI,Roboto`;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			const text = `$${br.value}`;
			// outline for readability
			ctx.lineWidth = 2;
			ctx.strokeStyle = 'rgba(0,0,0,0.75)';
			ctx.strokeText(text, br.x + br.w/2, br.y + br.h/2);
			ctx.fillStyle = '#ffffff';
			ctx.fillText(text, br.x + br.w/2, br.y + br.h/2);
			ctx.restore();
		}

		// draw balls
		// ball color palette per type for neon glow
		const BALL_COLORS = {
			standard: '#ffd166',
			heavy: '#ff6b66',
			sniper: '#9f7aea',
			scatter: '#60a5fa',
			scatterChild: '#93c5fd'
		};
		for(const b of activeBalls){
			ctx.beginPath();
			const color = BALL_COLORS[b.type] || '#ffd166';
			ctx.fillStyle = color;
			// add glow
			ctx.save();
			ctx.shadowColor = color;
			ctx.shadowBlur = 12;
			ctx.arc(b.x, b.y, b.r, 0, Math.PI*2);
			ctx.fill();
			ctx.restore();
			ctx.closePath();
		}

		// HUD
		ctx.fillStyle = 'rgba(255,255,255,0.06)';
		ctx.fillRect(0, GAME.height-30, GAME.width, 30);
		ctx.fillStyle = '#cfe8ff';
		ctx.font = '12px system-ui,Segoe UI,Roboto';
		const activeCount = activeBalls.filter(b => !b.isScatterChild).length;
		// left HUD: active balls
		ctx.textAlign = 'left';
		ctx.fillText(`Active balls: ${activeCount}`, 8, GAME.height-10);
		// right HUD: current level (opposite side of active ball counter)
		ctx.textAlign = 'right';
		ctx.fillText(`Level: ${level}`, GAME.width - 8, GAME.height-10);
		// reset text alignment to default
		ctx.textAlign = 'start';

		// draw crit bubbles (cartoon cloud + bold text)
		for(const cb of critBubbles){
			const life = Math.max(0, 1 - (cb.t / cb.ttl));
			const alpha = Math.min(1, life*1.2);
			const sx = cb.x;
			const sy = cb.y;
			ctx.save();
			ctx.globalAlpha = alpha;
			ctx.translate(sx, sy);
			ctx.rotate(cb.rot || 0);
			ctx.scale(cb.scale || 1, cb.scale || 1);
			// draw cloud using several circles
			ctx.fillStyle = '#ffffff';
			ctx.strokeStyle = '#111';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.arc(-28, 6, 12, 0, Math.PI*2);
			ctx.arc(-8, -4, 16, 0, Math.PI*2);
			ctx.arc(12, 6, 12, 0, Math.PI*2);
			ctx.arc(-2, 10, 14, 0, Math.PI*2);
			ctx.closePath();
			ctx.fill();
			ctx.stroke();
			// text: stroked outline then fill for maximum contrast over the cloud
			ctx.font = 'bold 16px system-ui,Segoe UI,Roboto';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.lineWidth = 4;
			ctx.strokeStyle = '#ffffff';
			ctx.strokeText(cb.text, 0, 2);
			ctx.fillStyle = '#111';
			ctx.fillText(cb.text, 0, 2);
			ctx.restore();
		}

		// Draw level transition overlay if active
		if(levelTransition.active){
			const elapsed = Math.max(0, _nowTime - levelTransition.start);
			const total = levelTransition.duration;
			let alpha = 0;
			if(elapsed <= levelTransition.fadeOut){
				alpha = (elapsed / levelTransition.fadeOut);
			} else if(elapsed <= (levelTransition.fadeOut + levelTransition.hold)){
				alpha = 1;
			} else if(elapsed <= total){
				alpha = 1 - ((elapsed - levelTransition.fadeOut - levelTransition.hold) / levelTransition.fadeIn);
			} else {
				alpha = 0;
			}
			alpha = Math.max(0, Math.min(1, alpha));
			// overlay
			ctx.save();
			ctx.fillStyle = `rgba(8,8,12,${0.85 * alpha})`;
			ctx.fillRect(0,0,GAME.width,GAME.height);
			// level text
			ctx.fillStyle = `rgba(255,255,255,${alpha})`;
			ctx.font = '48px system-ui,Segoe UI,Roboto';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			const txt = `Level ${levelTransition.nextLevel || (level+1)}`;
			ctx.fillText(txt, GAME.width/2, GAME.height/2);
			ctx.restore();
		}
	}

	let last = performance.now();
	// track last activity time for catch-up simulation when page was hidden
	let lastActivityTime = performance.now();
	function loop(now){
		_nowTime = now;
		const dt = (now - last)/1000;
		last = now;
		lastActivityTime = now;
		// update & draw snow on the background canvas
		if(typeof updateSnow === 'function') updateSnow(dt);
		if(typeof drawSnow === 'function') drawSnow();
		update(dt);
		draw();
		// finalize transition if needed
		if(levelTransition.active){
			const elapsed = now - levelTransition.start;
			if(elapsed >= levelTransition.duration){
				finalizeLevelTransition();
			}
		}
		requestAnimationFrame(loop);
	}

	requestAnimationFrame(loop);

	// Snow update/draw helpers that operate on `snowCanvas` if present
	function updateSnow(dt){
		const sw = (snowCanvas && snowCanvas.clientWidth) ? snowCanvas.clientWidth : GAME.width;
		const sh = (snowCanvas && snowCanvas.clientHeight) ? snowCanvas.clientHeight : GAME.height;
		for(const p of snowParticles){
			// gravity-like fall; larger flakes fall slightly faster
			p.y += p.speed * dt;
			// horizontal drift with slight oscillation and size-influenced drift
			p.x += Math.sin((p.y + p.angle) * 0.01) * p.drift * dt * (1 + p.r*0.12);
			// rotate the flake slowly
			p.angle += p.spin * 0.02;
			// wrap around bounds
			if(p.y - p.r > sh){ p.y = -p.r; p.x = Math.random()*sw; }
			if(p.x < -20) p.x = sw + 20;
			if(p.x > sw + 20) p.x = -20;
		}
	}

	function drawSnow(){
		if(!snowCtx) return;
		const sw = snowCanvas.clientWidth;
		const sh = snowCanvas.clientHeight;
		snowCtx.clearRect(0,0,sw,sh);
		// Draw star-like snowflakes: simple radiating lines for a delicate look
		for(const p of snowParticles){
			snowCtx.save();
			snowCtx.translate(p.x, p.y);
			snowCtx.rotate(p.angle);
			snowCtx.globalAlpha = Math.max(0.12, Math.min(1, p.alpha));
			snowCtx.strokeStyle = 'rgba(255,255,255,0.95)';
			snowCtx.lineWidth = Math.max(1, p.r*0.35);
			const branches = p.branches || 4;
			const len = Math.max(4, p.r * 4 + 2);
			for(let i=0;i<branches;i++){
				const a = (i / branches) * Math.PI * 2;
				const x = Math.cos(a) * len;
				const y = Math.sin(a) * len;
				snowCtx.beginPath();
				snowCtx.moveTo(0,0);
				snowCtx.lineTo(x,y);
				snowCtx.stroke();
				// small twig partway along the branch
				const twigX = Math.cos(a) * (len*0.55);
				const twigY = Math.sin(a) * (len*0.55);
				snowCtx.beginPath();
				snowCtx.moveTo(twigX, twigY);
				snowCtx.lineTo(twigX - Math.sin(a)* (len*0.12), twigY + Math.cos(a)*(len*0.12));
				snowCtx.stroke();
			}
			snowCtx.restore();
		}
	}

	// handle window resize to keep game size consistent
	window.addEventListener('resize', ()=>{
		// do nothing complicated: keep canvas pixel dims as set in HTML, but re-fit HiDPI
		fitCanvas();
		// also fit snow canvas
		fitSnowCanvas();
		// re-init snow positions to match new size
		initSnow(snowParticles.length || 100);
	});

	// Expose some helpers on window for debugging
	window._game = {money: ()=>money, bricks, activeBalls, save: saveGame, load: loadGame, maxActiveBalls: () => maxActiveBalls};

	// One-time diagnostics to help troubleshoot missing bricks / type loading.
	try{
		console.log('DEBUG: window.BALL_TYPES =', window.BALL_TYPES);
		console.log('DEBUG: local BALL_TYPES =', typeof BALL_TYPES !== 'undefined' ? BALL_TYPES : '<none>');
		console.log('DEBUG: bricks total =', bricks.length, 'alive =', bricks.filter(b => b && b.alive).length);
		if((bricks.length === 0) || (bricks.filter(b=>b&&b.alive).length === 0)){
			console.warn('DEBUG: No alive bricks after load/init. You can reset the save with: localStorage.removeItem(\'brickbreaker-save\'); localStorage.removeItem(\'brickbreaker-seen\'); location.reload();');
		}
	}catch(e){ console.warn('DEBUG: diagnostics failed', e); }

	// Save on tab close or when the page becomes hidden. Add multiple events for reliability
	window.addEventListener('beforeunload', saveGame);
	window.addEventListener('unload', saveGame);
	window.addEventListener('pagehide', saveGame);
	// Keep snow animating when the page is hidden by running a low-frequency background loop.
	let _snowBackgroundInterval = null;
	function startBackgroundSnow(){
		if(_snowBackgroundInterval) return;
		// run at ~12 FPS when hidden to conserve CPU
		_snowBackgroundInterval = setInterval(()=>{
			try{ updateSnow(1/12); drawSnow(); }catch(e){}
		}, 83);
	}
	function stopBackgroundSnow(){
		if(!_snowBackgroundInterval) return;
		clearInterval(_snowBackgroundInterval);
		_snowBackgroundInterval = null;
	}

	// Background game loop so the game continues updating/drawing when hidden
	let _bgInterval = null;
	let _bgLast = 0;
	let _bgLastSave = 0;
	let _bgWorker = null;
	let _renderWorker = null;
	let _renderingInWorker = false;

	function createRenderSnapshot(){
		// build a lightweight snapshot of visible state for the render worker
		try{
			return {
				game: { width: GAME.width, height: GAME.height, level },
				boss: boss ? { x: boss.x, y: boss.y, r: boss.r, alive: !!boss.alive, value: boss.value } : null,
				bricks: bricks.map(b => ({ x: b.x, y: b.y, w: b.w, h: b.h, alive: !!b.alive, value: b.value })),
				balls: activeBalls.map(b => ({ x: b.x, y: b.y, r: b.r, type: b.type || 'standard', isScatterChild: !!b.isScatterChild }))
			};
		}catch(e){ return null; }
	}
	function startBackgroundGame(){
		// If a Worker is available, use it for background ticks (less likely to be throttled).
		if(_bgWorker) return;
		_bgLastSave = performance.now();
		try{
			_bgWorker = new Worker('gameWorker.js');
			_bgWorker.onmessage = (ev) => {
				if(!ev || !ev.data) return;
				const d = ev.data;
				if(d.type === 'tick'){
					const dt = Math.max(0.016, d.dt);
					lastActivityTime = performance.now();
					try{
						if(typeof updateSnow === 'function') updateSnow(dt);
						update(dt);
						if(typeof drawSnow === 'function') drawSnow();
						// if a render worker is active, send a lightweight state snapshot to it
						if(_renderWorker){
							const snap = createRenderSnapshot();
							try{ _renderWorker.postMessage({type:'state', state: snap}); }catch(e){}
						} else {
							draw();
						}
						if(levelTransition && levelTransition.active){
							const elapsed = performance.now() - levelTransition.start;
							if(elapsed >= levelTransition.duration) finalizeLevelTransition();
						}
					}catch(e){}
					if(performance.now() - _bgLastSave >= 5000){ saveGame(); _bgLastSave = performance.now(); }
				}
			};
		}catch(e){
			// fallback to interval if Worker cannot be created
			_bgInterval = setInterval(()=>{
				const now = performance.now();
				const dt = Math.max(0.016, (now - _bgLast)/1000);
				_bgLast = now;
				lastActivityTime = now;
				try{
					if(typeof updateSnow === 'function') updateSnow(dt);
					update(dt);
					if(typeof drawSnow === 'function') drawSnow();
					draw();
					if(levelTransition && levelTransition.active){
						const elapsed = now - levelTransition.start;
						if(elapsed >= levelTransition.duration){ finalizeLevelTransition(); }
					}
				}catch(e){}
				if(now - _bgLastSave >= 5000){ saveGame(); _bgLastSave = now; }
			}, 200);
		}
	}

	function stopBackgroundGame(){
		if(_bgWorker){
			try{ _bgWorker.postMessage({type:'stop'}); }catch(e){}
			try{ _bgWorker.terminate(); }catch(e){}
			_bgWorker = null;
		}
		if(_bgInterval){
			clearInterval(_bgInterval);
			_bgInterval = null;
		}
	}

	// Render worker control: transfer the DOM canvas to a render worker when hidden
	function startRenderWorker(){
		if(_renderWorker || !_bgWorker) return;
		// Only proceed if OffscreenCanvas transfer is supported
		if(!canvas || typeof canvas.transferControlToOffscreen !== 'function') return;
		let w = null;
		try{
			// create worker first so we don't transfer the DOM canvas unless worker creation succeeds
			w = new Worker('renderWorker.js');
		}catch(e){
			w = null;
		}
		if(!w) return; // cannot create worker (e.g., file://) — abort
		try{
			const off = canvas.transferControlToOffscreen();
			w.postMessage({type:'init', canvas: off, width: GAME.width, height: GAME.height}, [off]);
			_renderWorker = w;
			_renderingInWorker = true;
		}catch(e){
			// if transfer failed, terminate worker and fall back
			try{ w.terminate(); }catch(_){ }
			_renderWorker = null;
			_renderingInWorker = false;
			// leave canvas intact; nothing else to do
		}
	}

	function stopRenderWorker(){
		if(!_renderWorker) return;
		try{ _renderWorker.postMessage({type:'stop'}); }catch(e){}
		try{ _renderWorker.terminate(); }catch(e){}
		_renderWorker = null;
		_renderingInWorker = false;
		// recreate the DOM canvas since it was transferred
		try{
			const old = document.getElementById('gameCanvas');
			if(old && old.parentNode){
				const parent = old.parentNode;
				const newCanvas = document.createElement('canvas');
				newCanvas.id = 'gameCanvas';
				newCanvas.width = GAME.width;
				newCanvas.height = GAME.height;
				newCanvas.setAttribute('aria-label','Brick breaker game canvas');
				parent.replaceChild(newCanvas, old);
				canvas = newCanvas;
				ctx = canvas.getContext('2d');
				fitCanvas();
			}
		}catch(e){}
	}

	// Remove offline earning config — earnings while hidden are disabled
	let hiddenStart = null;

	// Simple toast helper for user-visible messages
	function showToast(msg, time = 3000){
		let el = document.createElement('div');
		el.className = 'bb-toast';
		el.textContent = msg;
		Object.assign(el.style, {
			position: 'fixed',
			top: '12px',
			left: '50%',
			transform: 'translateX(-50%)',
			background: 'rgba(0,0,0,0.7)',
			color: '#fff',
			padding: '8px 12px',
			borderRadius: '8px',
			zIndex: 2000,
			fontSize: '14px',
			boxShadow: '0 6px 18px rgba(0,0,0,0.4)'
		});
		document.body.appendChild(el);
		setTimeout(()=>{ el.style.transition = 'opacity 400ms'; el.style.opacity = '0'; }, time - 400);
		setTimeout(()=>{ if(el && el.parentNode) el.parentNode.removeChild(el); }, time);
	}

		document.addEventListener('visibilitychange', ()=>{
			const now = performance.now();
			if(document.hidden){
				saveGame();
				startBackgroundSnow();
				startBackgroundGame();
				// attempt to move rendering to worker so visuals continue while hidden
				startRenderWorker();
				hiddenStart = now;
			} else {
				// stop background loops
				stopBackgroundSnow();
				stopBackgroundGame();
				// stop render worker and recreate canvas so main-thread rendering resumes
				stopRenderWorker();
				// no passive earnings while hidden — just resume visual/background loops
				if(hiddenStart){ /* noop */ }
				hiddenStart = null;
				lastActivityTime = now;
			}
		});

	// small keyboard shortcuts
	window.addEventListener('keydown', (e)=>{
		if(e.key === 'b') buyBall();
		if(e.key === 'r') releaseBalls();
		if(e.key === 'n') {
			// refill bricks for current level
			initBricks(level);
		}
	});

})();

