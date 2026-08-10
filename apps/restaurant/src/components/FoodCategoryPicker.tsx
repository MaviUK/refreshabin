import { useMemo, useState } from 'react'
import { foodCategoryGroups } from '../lib/foodCategories'
import './FoodCategoryPicker.css'

type FoodCategoryPickerProps = {
  value: string[]
  onChange: (next: string[]) => void
}

export default function FoodCategoryPicker({ value, onChange }: FoodCategoryPickerProps) {
  const [query, setQuery] = useState('')
  const normalisedQuery = query.trim().toLowerCase()

  const visibleGroups = useMemo(() => foodCategoryGroups
    .map((group) => ({
      ...group,
      categories: normalisedQuery
        ? group.categories.filter((category) => category.toLowerCase().includes(normalisedQuery))
        : group.categories,
    }))
    .filter((group) => group.categories.length > 0), [normalisedQuery])

  function toggleCategory(category: string) {
    if (value.includes(category)) {
      onChange(value.filter((item) => item !== category))
      return
    }
    onChange([...value, category])
  }

  function makePrimary(category: string) {
    if (!value.includes(category) || value[0] === category) return
    onChange([category, ...value.filter((item) => item !== category)])
  }

  return (
    <section className="food-category-picker" aria-labelledby="food-category-picker-title">
      <div className="food-category-picker-heading">
        <div>
          <h3 id="food-category-picker-title">Food categories</h3>
          <p>Select every category customers should be able to find you under. Your primary category is shown first.</p>
        </div>
        <span className="food-category-count">{value.length} selected</span>
      </div>

      {value.length > 0 && (
        <div className="food-category-selected" aria-label="Selected food categories">
          {value.map((category, index) => (
            <div className={index === 0 ? 'food-category-selected-chip primary' : 'food-category-selected-chip'} key={category}>
              <button type="button" onClick={() => toggleCategory(category)} aria-label={`Remove ${category}`}>{category} <span aria-hidden="true">×</span></button>
              {index === 0
                ? <span className="food-category-primary-badge">Primary</span>
                : <button className="food-category-make-primary" type="button" onClick={() => makePrimary(category)}>Make primary</button>}
            </div>
          ))}
        </div>
      )}

      <label className="food-category-search">
        <span>Search categories</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try sushi, halal, brunch, Caribbean…" />
      </label>

      <div className="food-category-groups">
        {visibleGroups.map((group) => (
          <section className="food-category-group" key={group.label}>
            <div className="food-category-group-heading">
              <h4>{group.label}</h4>
              <p>{group.description}</p>
            </div>
            <div className="food-category-options">
              {group.categories.map((category) => {
                const selected = value.includes(category)
                const primary = value[0] === category
                return (
                  <button
                    className={`food-category-option${selected ? ' selected' : ''}${primary ? ' primary' : ''}`}
                    type="button"
                    key={category}
                    aria-pressed={selected}
                    onClick={() => toggleCategory(category)}
                  >
                    {selected && <span aria-hidden="true">✓</span>}
                    {category}
                    {primary && <small>Primary</small>}
                  </button>
                )
              })}
            </div>
          </section>
        ))}
        {visibleGroups.length === 0 && <p className="food-category-no-results">No categories match “{query}”.</p>}
      </div>
    </section>
  )
}
