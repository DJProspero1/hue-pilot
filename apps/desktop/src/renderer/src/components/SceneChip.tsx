import type { SceneView } from '@hue/core';
import { Sparkles } from 'lucide-react';
import { useApp } from '../store';
import { cx } from './ui';

/** A scene tile painted with its palette. Click activates; the sparkle starts/stops dynamic mode. */
export default function SceneChip({ scene, large, showGroup }: { scene: SceneView; large?: boolean; showGroup?: boolean }) {
  const recallScene = useApp((s) => s.recallScene);
  const active = scene.active !== 'inactive';
  const gradient = scene.palette.length
    ? `linear-gradient(135deg, ${scene.palette.length === 1 ? `${scene.palette[0]}, ${scene.palette[0]}` : scene.palette.join(', ')})`
    : 'linear-gradient(135deg, #ffd9a0, #ffb36b)';
  return (
    <button
      onClick={() => recallScene(scene.id, 'active')}
      className={cx(
        'group relative shrink-0 overflow-hidden rounded-2xl border text-left transition-all',
        large ? 'h-[96px] w-[168px]' : 'h-[72px] w-[140px]',
        active ? 'border-accent shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent)_40%,transparent)]' : 'border-[var(--border)] hover:border-[var(--border-strong)] hover:-translate-y-px',
      )}
      title={scene.name}
    >
      <div className="absolute inset-0 opacity-90" style={{ background: gradient }} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />
      <div className="absolute bottom-2 left-3 right-2 text-white drop-shadow">
        <div className="text-sm font-semibold truncate">{scene.name}</div>
        <div className="text-[10px] uppercase tracking-wide opacity-90 truncate">{active ? (scene.active === 'dynamic_palette' ? 'Dynamic' : 'Active') : showGroup ? scene.groupName : ''}</div>
      </div>
      {scene.supportsDynamic && (
        <span
          role="button"
          title="Dynamic"
          onClick={(e) => {
            e.stopPropagation();
            recallScene(scene.id, scene.active === 'dynamic_palette' ? 'static' : 'dynamic_palette');
          }}
          className={cx('absolute right-2 top-2 rounded-full bg-black/40 p-1.5 text-white backdrop-blur transition-opacity hover:bg-black/60', scene.active === 'dynamic_palette' ? 'opacity-100 ring-2 ring-white/70' : 'opacity-0 group-hover:opacity-100')}
        >
          <Sparkles size={12} />
        </span>
      )}
    </button>
  );
}
