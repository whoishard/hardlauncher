import React from 'react';

/** Slider + input numérico sincronizados para elegir MB de RAM. */
export default function MemorySlider({ label, value, onChange, min = 512, max = 16384, step = 256 }) {
  const fillPercent = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));

  function handleSliderChange(e) {
    onChange(Number(e.target.value));
  }

  function handleInputChange(e) {
    const raw = e.target.value.replace(/[^0-9]/g, '');
    onChange(raw === '' ? 0 : Math.min(max, Number(raw)));
  }

  return (
    <div>
      {label && <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>{label}</label>}
      <div className="memory-slider-row">
        <input
          type="range"
          className="memory-slider"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleSliderChange}
          style={{ '--fill': `${fillPercent}%` }}
        />
        <input type="text" inputMode="numeric" className="memory-slider-input" value={value} onChange={handleInputChange} />
        <span className="memory-slider-suffix">MB</span>
      </div>
    </div>
  );
}
