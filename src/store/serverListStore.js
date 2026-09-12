// Lista de "servidores recomendados" del launcher.
//
// A propósito esto YA NO es editable desde la UI (ni desde Ajustes, ni
// desde ningún botón "+" en Inicio): es un array fijo acá en el código.
// Para agregar/sacar un servidor hay que editar este archivo a mano y
// volver a compilar el launcher — así el dueño del launcher (Hard, no
// cualquiera que lo abra) es el único que controla qué servidores se
// publicitan. El id de cada uno es estable a propósito (no un uuid random
// generado en cada arranque) para que persista igual entre versiones, y
// para que instanceStore pueda usarlo como key al escribir el servers.dat
// de cada instancia nueva.
//
// host/port: dirección real del servidor. port 25565 es el default de
// Minecraft Java, no hace falta mostrarlo en la UI cuando coincide.
const DEFAULT_SERVERS = [
  {
    id: 'caraotamc',
    name: 'CaraotaMC Network',
    host: '144.202.83.124',
    port: 4016,
  },
  {
    id: 'arefy',
    name: 'Arefy Network',
    host: 'arefy.net',
    port: 25565,
  },
];

function listServers() {
  return DEFAULT_SERVERS;
}

module.exports = { listServers, DEFAULT_SERVERS };
