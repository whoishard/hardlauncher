import React from 'react';

// Pinta el MOTD de un servidor tal cual lo devuelve serverPing.js: una
// lista de segmentos ya resueltos {text, color, bold, italic, underline,
// strikethrough, obfuscated}, uno por cada "tramo" con formato distinto.
// El texto "obfuscado" (código §k, se ve como caracteres random que
// cambian solo) no se simula de verdad acá (sería contenido engañoso
// parpadeando) — se muestra normal, ya es un detalle menor del MOTD.
export default function MinecraftMotd({ segments, className }) {
  if (!segments || segments.length === 0) return null;
  return (
    <span className={'mc-motd' + (className ? ` ${className}` : '')}>
      {segments.map((seg, i) => (
        <span
          key={i}
          style={{
            color: seg.color || undefined,
            fontWeight: seg.bold ? 700 : undefined,
            fontStyle: seg.italic ? 'italic' : undefined,
            textDecoration:
              [seg.underline && 'underline', seg.strikethrough && 'line-through'].filter(Boolean).join(' ') || undefined,
          }}
        >
          {seg.text}
        </span>
      ))}
    </span>
  );
}
