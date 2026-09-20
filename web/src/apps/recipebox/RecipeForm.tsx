import type { Draft } from './draft'
import type { Recipe } from './types'

/** Edit mode (§9.3). One form, one Save, one Cancel — the page owns both. */

interface Props {
  recipe: Recipe
  draft: Draft
  onChange: (draft: Draft) => void
}

export default function RecipeForm({ recipe, draft, onChange }: Props) {
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    onChange({ ...draft, [key]: value })

  const setGroup = (index: number, patch: Partial<Draft['groups'][number]>) =>
    onChange({
      ...draft,
      groups: draft.groups.map((group, i) =>
        i === index ? { ...group, ...patch } : group,
      ),
    })

  return (
    <div className="rb-form">
      <label className="rb-field">
        <span>Title</span>
        <input value={draft.title} onChange={(e) => set('title', e.target.value)} />
      </label>

      <label className="rb-field">
        <span>Description</span>
        <textarea
          rows={3}
          value={draft.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </label>

      <label className="rb-field">
        <span>Origin</span>
        <input
          value={draft.origin}
          onChange={(e) => set('origin', e.target.value)}
          placeholder="Only when the source said so"
        />
      </label>

      <fieldset className="rb-fieldset">
        <legend>Ingredients</legend>
        {draft.groups.map((group, index) => (
          <div className="rb-group" key={index}>
            <div className="rb-group-head">
              <input
                value={group.heading}
                onChange={(e) => setGroup(index, { heading: e.target.value })}
                placeholder="Group heading (optional)"
                aria-label={`Ingredient group ${index + 1} heading`}
              />
              <button
                type="button"
                className="rb-text-button"
                onClick={() =>
                  onChange({
                    ...draft,
                    groups: draft.groups.filter((_, i) => i !== index),
                  })
                }
              >
                Remove group
              </button>
            </div>
            <textarea
              rows={Math.max(4, group.items.split('\n').length + 1)}
              value={group.items}
              onChange={(e) => setGroup(index, { items: e.target.value })}
              placeholder="One ingredient per line"
              aria-label={`Ingredient group ${index + 1} items`}
            />
          </div>
        ))}
        <button
          type="button"
          className="rb-text-button"
          onClick={() =>
            onChange({ ...draft, groups: [...draft.groups, { heading: '', items: '' }] })
          }
        >
          Add a group
        </button>
      </fieldset>

      <label className="rb-field">
        <span>Steps — one per line</span>
        <textarea
          rows={Math.max(6, draft.steps.split('\n').length + 1)}
          value={draft.steps}
          onChange={(e) => set('steps', e.target.value)}
        />
      </label>

      <label className="rb-field">
        <span>Notes — one per line</span>
        <textarea
          rows={Math.max(3, draft.notes.split('\n').length + 1)}
          value={draft.notes}
          onChange={(e) => set('notes', e.target.value)}
        />
      </label>

      <div className="rb-field-row">
        <label className="rb-field rb-field-small">
          <span>Serves</span>
          <input
            inputMode="numeric"
            value={draft.servings}
            onChange={(e) => set('servings', e.target.value)}
          />
        </label>
        <label className="rb-field">
          <span>Or yields</span>
          <input
            value={draft.yieldText}
            onChange={(e) => set('yieldText', e.target.value)}
            placeholder="24 cookies"
          />
        </label>
      </div>

      <div className="rb-field-row">
        {(
          [
            ['prepMinutes', 'Prep (min)'],
            ['cookMinutes', 'Cook (min)'],
            ['totalMinutes', 'Total (min)'],
          ] as const
        ).map(([key, label]) => (
          <label className="rb-field rb-field-small" key={key}>
            <span>{label}</span>
            <input
              inputMode="numeric"
              value={draft[key]}
              onChange={(e) => set(key, e.target.value)}
            />
          </label>
        ))}
      </div>

      {/* The record carries no source URL, so there is nothing to link to (§1.3). */}
      {recipe.requestText && (
        <p className="rb-note">Found for: {recipe.requestText}</p>
      )}
    </div>
  )
}
