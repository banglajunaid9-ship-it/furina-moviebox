import React, { useEffect, useRef, useState } from 'react';
import { resolvePosterUrl } from '../../services/contentModel';

// A 3D ring of posters that turns to the active item.
// Drag (mouse or touch) to spin it; release snaps to the nearest poster.
// Clicking a side poster selects it; clicking the front poster calls onActivate.

const POSTER_W = 132;
const POSTER_H = 198;
const DRAG_DEG_PER_PX = 0.35;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

function RingPoster({ item }) {
  const [stage, setStage] = useState(0); // 0 poster, 1 backdrop, 2 title tile
  const title = item?.title || item?.name || 'Untitled';
  const src =
    stage === 0
      ? resolvePosterUrl(item?.poster_path || item?.backdrop_path, 'w342')
      : resolvePosterUrl(item?.backdrop_path, 'w342');

  if (stage === 2 || (!item?.poster_path && !item?.backdrop_path)) {
    return (
      <div className="w-full h-full flex items-end p-3 bg-gradient-to-b from-[#0b1d47] to-[#030a1d]">
        <span className="text-[13px] font-black leading-tight text-white line-clamp-3">{title}</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={title}
      draggable={false}
      loading="lazy"
      decoding="async"
      onError={() => setStage((s) => (s === 0 && item?.backdrop_path ? 1 : 2))}
      className="w-full h-full object-cover select-none"
    />
  );
}

export default function PosterRing3D({ items, activeIndex, onSelect, onActivate, lowMotion = false }) {
  const count = items.length;
  const step = 360 / count;
  // Radius that lets neighbouring posters sit edge to edge with a small gap.
  const radius = Math.round((POSTER_W / 2 + 10) / Math.tan(Math.PI / count));

  const reducedMotion = usePrefersReducedMotion() || lowMotion;

  // Cumulative rotation so wrapping from last to first turns the short way.
  const [rotation, setRotation] = useState(-activeIndex * step);
  const lastIndexRef = useRef(activeIndex);
  const [dragOffset, setDragOffset] = useState(0);
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    const prev = lastIndexRef.current;
    if (prev === activeIndex) return;
    let diff = activeIndex - prev;
    if (diff > count / 2) diff -= count;
    if (diff < -count / 2) diff += count;
    setRotation((r) => r - diff * step);
    lastIndexRef.current = activeIndex;
  }, [activeIndex, count, step]);

  const currentAngle = rotation + dragOffset;

  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    dragRef.current = { startX: e.clientX, moved: false, pointerId: e.pointerId };
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) > 4) {
      d.moved = true;
      e.currentTarget.setPointerCapture?.(d.pointerId);
    }
    if (d.moved) setDragOffset(dx * DRAG_DEG_PER_PX);
  };

  const endDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || !d.moved) return;
    suppressClickRef.current = true;
    setTimeout(() => { suppressClickRef.current = false; }, 0);
    const steps = Math.round(dragOffset / step);
    setDragOffset(0);
    if (steps !== 0) {
      // Apply the snapped turn directly, then tell the parent which item is in front.
      const nextIndex = (((activeIndex - steps) % count) + count) % count;
      setRotation((r) => r + steps * step);
      lastIndexRef.current = nextIndex;
      onSelect(nextIndex);
    }
  };

  const handlePosterClick = (idx) => {
    if (suppressClickRef.current) return;
    if (idx === activeIndex) onActivate?.(items[idx]);
    else onSelect(idx);
  };

  return (
    <div
      className="relative select-none touch-pan-y"
      style={{ width: radius * 2 + POSTER_W, height: POSTER_H + 70, perspective: 1100 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={endDrag}
      role="listbox"
      aria-label="Featured titles"
    >
      <div
        className={reducedMotion ? '' : 'poster-ring-float'}
        style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d' }}
      >
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 18,
            width: POSTER_W,
            height: POSTER_H,
            marginLeft: -POSTER_W / 2,
            transformStyle: 'preserve-3d',
            transform: `translateZ(${-radius}px) rotateX(-6deg) rotateY(${currentAngle}deg)`,
            transition:
              dragRef.current?.moved || reducedMotion
                ? 'none'
                : 'transform 0.9s cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          {items.map((item, idx) => {
            // Angular distance from facing the viewer (0 = front, 180 = back).
            const facing = Math.abs(((((idx * step + currentAngle) % 360) + 540) % 360) - 180);
            const nearness = 1 - facing / 180; // 1 at front, 0 at back
            const isFront = idx === activeIndex && dragOffset === 0;
            return (
              <button
                key={item?.id ?? idx}
                type="button"
                role="option"
                aria-selected={idx === activeIndex}
                aria-label={item?.title || item?.name || `Title ${idx + 1}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handlePosterClick(idx);
                }}
                className="absolute inset-0 rounded-xl overflow-hidden cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
                style={{
                  transform: `rotateY(${idx * step}deg) translateZ(${radius}px)`,
                  backfaceVisibility: 'hidden',
                  opacity: 0.25 + nearness * 0.75,
                  filter: `brightness(${0.45 + nearness * 0.55})`,
                  border: isFront ? '2px solid rgba(103, 232, 249, 0.95)' : '1px solid rgba(56, 189, 248, 0.25)',
                  boxShadow: isFront
                    ? '0 18px 40px rgba(0,0,0,0.75), 0 0 28px rgba(34, 211, 238, 0.55)'
                    : '0 10px 24px rgba(0,0,0,0.6)',
                  transition: 'opacity 0.5s ease, filter 0.5s ease, box-shadow 0.4s ease, border-color 0.4s ease',
                }}
              >
                <RingPoster item={item} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Soft reflection pool under the ring */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-[50%]"
        style={{
          bottom: 4,
          width: POSTER_W * 2.4,
          height: 26,
          background: 'radial-gradient(ellipse at center, rgba(34,211,238,0.35) 0%, rgba(34,211,238,0.08) 45%, transparent 75%)',
          filter: 'blur(4px)',
        }}
      />
    </div>
  );
}
