// Ball types moved out of main script to keep things tidy.
// Exposes `window.BALL_TYPES` so `script.js` can read them.
(function(){
    window.BALL_TYPES = [
        // Balanced pricing (tuned): standard is cheap, special balls cost more for their utility
        { id: 'standard', name: 'Standard', price: 10, baseDamage: 1, desc: 'Balanced ball' },
        { id: 'heavy', name: 'Heavy', price: 45, baseDamage: 5, desc: 'Slower, much higher damage' },
        { id: 'sniper', name: 'Sniper', price: 70, baseDamage: 1, desc: 'Seeks nearest brick and prioritizes it; lower damage, auto-aims' },
        { id: 'scatter', name: 'Scatter', price: 50, baseDamage: 2, desc: 'Splits into smaller balls on hit; children ignore ball limit' }
    ];
})();
