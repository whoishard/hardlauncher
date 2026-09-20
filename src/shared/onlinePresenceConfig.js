// Credenciales del proyecto de Supabase usado ÚNICAMENTE para el contador
// de "jugadores en línea" (ver src/core/onlinePresence.js). Igual que
// serverListStore.js, esto es a propósito código fijo: lo completa quien
// compila el launcher (Hard), no algo que un jugador configure desde la
// UI.
//
// Cómo conseguir estos dos valores:
//   1. Crear un proyecto gratis en https://supabase.com/dashboard
//   2. Ajustes del proyecto → API → copiar "Project URL" y la clave
//      "anon public" (NUNCA la "service_role": esa es secreta y no debe
//      viajar dentro de la app).
//
// La clave "anon" está pensada para ser pública — viaja embebida en
// cualquier app cliente (web, mobile, launchers como este) sin problema,
// funciona como CUALQUIER launcher: no da acceso a nada por sí sola, y acá
// ni siquiera se usa para leer/escribir una tabla, solo para conectarse al
// canal de Presence (ver onlinePresence.js), que no requiere tocar la
// base de datos.
//
// Si se deja "" (vacío), el contador queda desactivado en silencio: no
// rompe el launcher, simplemente no se conecta a nada ni se muestra nada.
const SUPABASE_URL = 'https://denhmzgvauvqheohxzdz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_DhYfsMZenMlMWjTwyxoMjA_6hKbuNNK';

// Nombre del canal de Presence. Cambiarlo invalida el conteo anterior de
// golpe (arranca todos los launchers reportándose a un canal nuevo) —
// normalmente no hace falta tocarlo.
const PRESENCE_CHANNEL = 'hardlauncher-online';

module.exports = { SUPABASE_URL, SUPABASE_ANON_KEY, PRESENCE_CHANNEL };
