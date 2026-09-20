/**
 * Contenido de "Términos y Condiciones" mostrado por TermsModal.jsx.
 *
 * Vive en su propio archivo (en vez de sumar ~150 líneas más a i18n.js) por
 * ser texto largo y de un solo uso — TermsModal.jsx elige el bloque según
 * `settings.language` (con fallback a 'es'), igual que hace el resto de la
 * app con `useT()`.
 *
 * Cada sección trae además un `icon` (nombre de Icon.jsx) y su heading ya
 * NO lleva el número escrito a mano adelante: el número lo pinta el propio
 * diseño del modal (la chapita redonda de la izquierda), así que agregar,
 * sacar o reordenar secciones acá no obliga a renumerar nada a mano.
 *
 * El texto de cada sección es deliberadamente genérico (uso del software,
 * cuentas Offline/Microsoft, contenido de terceros vía Modrinth,
 * responsabilidad del usuario, actualizaciones automáticas) — no reemplaza
 * un texto legal redactado a medida, pero cubre los puntos que un launcher
 * de este tipo necesita dejar en claro antes de que alguien lo use.
 */
export const TERMS_CONTENT = {
  es: {
    title: 'Términos y Condiciones',
    intro:
      'Antes de seguir, leé y aceptá estos términos. Se te va a volver a mostrar esta pantalla cada vez que el launcher se actualice a una versión nueva.',
    sections: [
      {
        heading: 'Qué es Hard Launcher',
        icon: 'info',
        body: 'Hard Launcher es un launcher de Minecraft de terceros, no oficial. No está afiliado, respaldado ni asociado con Mojang Studios ni con Microsoft. "Minecraft" es una marca registrada de Mojang Studios.',
      },
      {
        heading: 'Cuentas y juego legítimo',
        icon: 'user',
        body: 'El inicio de sesión con cuenta Microsoft requiere una copia legítima de Minecraft: Java Edition asociada a esa cuenta. El modo de cuenta "No-Premium" (offline) está pensado únicamente para quienes ya son dueños del juego (por ejemplo, para jugar en servidores propios o LAN) y no habilita ni promueve el uso de una copia no adquirida legalmente.',
      },
      {
        heading: 'Contenido de terceros (mods, modpacks, resource packs, shaders)',
        icon: 'package',
        body: 'El contenido que se instala desde Explorar se descarga directo de Modrinth y lo publican sus propios autores, ajenos a Hard Launcher. No revisamos ni garantizamos ese contenido: instalarlo y usarlo es responsabilidad tuya. Cualquier problema, licencia o término de uso propio de un mod puntual corresponde a su autor/proyecto en Modrinth.',
      },
      {
        heading: 'Actualizaciones automáticas',
        icon: 'download',
        body: 'El launcher chequea periódicamente si hay una versión nueva y la descarga en segundo plano para mantenerte al día con arreglos y mejoras. Podés ver el progreso y elegir cuándo reiniciar para aplicarla.',
      },
      {
        heading: 'Uso del software',
        icon: 'alertTriangle',
        body: 'Usás Hard Launcher bajo tu propia responsabilidad. En la medida permitida por la ley, se provee "tal cual", sin garantías de ningún tipo, y no nos hacemos responsables por pérdida de mundos, configuraciones u otros datos — se recomienda hacer respaldos propios de partidas importantes.',
      },
      {
        heading: 'Cambios a estos términos',
        icon: 'refresh',
        body: 'Estos términos pueden actualizarse en versiones futuras del launcher. Cuando eso pase, se te va a pedir que los aceptes de nuevo antes de seguir usándolo.',
      },
    ],
    eyebrow: 'Antes de empezar',
    agree: 'Leí y acepto los Términos y Condiciones.',
    footnote: 'Hard Launcher es un proyecto no oficial, sin relación con Mojang Studios ni Microsoft.',
    accept: 'Aceptar y continuar',
    decline: 'Rechazar y salir',
  },

  en: {
    title: 'Terms and Conditions',
    intro:
      'Please read and accept these terms before continuing. You will be shown this screen again whenever the launcher updates to a new version.',
    sections: [
      {
        heading: 'What Hard Launcher is',
        icon: 'info',
        body: 'Hard Launcher is an unofficial, third-party Minecraft launcher. It is not affiliated with, endorsed by, or associated with Mojang Studios or Microsoft. "Minecraft" is a trademark of Mojang Studios.',
      },
      {
        heading: 'Accounts and legitimate play',
        icon: 'user',
        body: 'Signing in with a Microsoft account requires a legitimate copy of Minecraft: Java Edition linked to that account. The "Offline" account mode is intended only for players who already own the game (for example, for singleplayer or LAN/self-hosted servers) and does not enable or promote the use of a copy that was not legally acquired.',
      },
      {
        heading: 'Third-party content (mods, modpacks, resource packs, shaders)',
        icon: 'package',
        body: "Content installed from Explore is downloaded directly from Modrinth and published by its own authors, unrelated to Hard Launcher. We don't review or guarantee that content — installing and using it is your own responsibility. Any issues, licensing, or usage terms specific to a given mod are that project's own, on Modrinth.",
      },
      {
        heading: 'Automatic updates',
        icon: 'download',
        body: 'The launcher periodically checks for a newer version and downloads it in the background so you stay up to date with fixes and improvements. You can see the progress and choose when to restart to apply it.',
      },
      {
        heading: 'Use of the software',
        icon: 'alertTriangle',
        body: 'You use Hard Launcher at your own risk. To the extent permitted by law, it is provided "as is", without warranties of any kind, and we are not liable for lost worlds, configuration, or other data — back up anything important yourself.',
      },
      {
        heading: 'Changes to these terms',
        icon: 'refresh',
        body: 'These terms may be updated in future versions of the launcher. When that happens, you will be asked to accept them again before continuing to use it.',
      },
    ],
    eyebrow: 'Before you start',
    agree: 'I have read and accept the Terms and Conditions.',
    footnote: 'Hard Launcher is an unofficial project, unaffiliated with Mojang Studios or Microsoft.',
    accept: 'Accept and continue',
    decline: 'Decline and quit',
  },

  pt: {
    title: 'Termos e Condições',
    intro:
      'Leia e aceite estes termos antes de continuar. Esta tela vai aparecer de novo toda vez que o launcher for atualizado para uma versão nova.',
    sections: [
      {
        heading: 'O que é o Hard Launcher',
        icon: 'info',
        body: 'Hard Launcher é um launcher de Minecraft não oficial, de terceiros. Não é afiliado, endossado nem associado à Mojang Studios ou à Microsoft. "Minecraft" é uma marca registrada da Mojang Studios.',
      },
      {
        heading: 'Contas e uso legítimo',
        icon: 'user',
        body: 'Entrar com uma conta Microsoft exige uma cópia legítima de Minecraft: Java Edition vinculada a essa conta. O modo de conta "Offline" é pensado apenas para quem já é dono do jogo (por exemplo, para jogar sozinho ou em servidores próprios/LAN) e não habilita nem incentiva o uso de uma cópia não adquirida legalmente.',
      },
      {
        heading: 'Conteúdo de terceiros (mods, modpacks, resource packs, shaders)',
        icon: 'package',
        body: 'O conteúdo instalado pela aba Explorar é baixado diretamente do Modrinth e publicado por seus próprios autores, sem relação com o Hard Launcher. Não revisamos nem garantimos esse conteúdo: instalá-lo e usá-lo é responsabilidade sua. Qualquer problema, licença ou termo de uso específico de um mod é do próprio projeto no Modrinth.',
      },
      {
        heading: 'Atualizações automáticas',
        icon: 'download',
        body: 'O launcher verifica periodicamente se há uma versão mais nova e a baixa em segundo plano para manter você atualizado com correções e melhorias. Você pode ver o progresso e escolher quando reiniciar para aplicá-la.',
      },
      {
        heading: 'Uso do software',
        icon: 'alertTriangle',
        body: 'Você usa o Hard Launcher por sua conta e risco. Na medida permitida por lei, ele é fornecido "como está", sem garantias de nenhum tipo, e não nos responsabilizamos por mundos, configurações ou outros dados perdidos — recomendamos fazer seus próprios backups de partidas importantes.',
      },
      {
        heading: 'Mudanças nestes termos',
        icon: 'refresh',
        body: 'Estes termos podem ser atualizados em versões futuras do launcher. Quando isso acontecer, você será solicitado a aceitá-los novamente antes de continuar usando.',
      },
    ],
    eyebrow: 'Antes de começar',
    agree: 'Li e aceito os Termos e Condições.',
    footnote: 'Hard Launcher é um projeto não oficial, sem relação com a Mojang Studios ou a Microsoft.',
    accept: 'Aceitar e continuar',
    decline: 'Recusar e sair',
  },
};

export function getTermsContent(language) {
  return TERMS_CONTENT[language] || TERMS_CONTENT.es;
}
