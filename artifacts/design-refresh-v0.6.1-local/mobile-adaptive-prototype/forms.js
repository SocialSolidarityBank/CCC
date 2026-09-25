/**
 * Mobile-only adaptations for the captured writing and participant screens.
 *
 * The captured HTML remains the source of truth: this module reorders and moves
 * those nodes instead of rebuilding fields, so browser values and input IDs stay
 * intact. The temporary structure differences are deliberately scoped to the B
 * variant and are removed by the returned cleanup functions before a rerender.
 */

function isMobilePrototype(api) {
  return Boolean(api?.mobile)
}

function on(target, type, listener, options, cleanup) {
  target.addEventListener(type, listener, options)
  cleanup.push(() => target.removeEventListener(type, listener, options))
}


function setRailItemState(item, done) {
  if (!item) return
  item.dataset.done = String(done)
  const checkbox = item.querySelector('.wire-checkbox')
  if (checkbox) checkbox.dataset.checked = String(done)
  const state = item.querySelector('.record-rail-state')
  if (state) state.textContent = done ? ' 채움' : ' 남음'
}

/**
 * Refreshes the captured checklist rail from the values currently in the form.
 * Exported for the parent so state can be refreshed after a rerender or submit.
 */
export function updateWriteState(root) {
  const form = root?.querySelector?.('form.record-form')
  const rail = root?.querySelector?.('.record-side')
  if (!form || !rail) return

  const items = rail.querySelectorAll('.record-rail-list > li')
  const memo = form.querySelector('#record-memo')
  const hasMemo = Boolean(memo?.value?.trim())
  setRailItemState(items[0], hasMemo)

  const actionDescriptions = [...form.querySelectorAll('[name^="actionDescription"]')]
  const hasActions = actionDescriptions.some((field) => field.value.trim())
  const actionSection = form.querySelector('#open-actions-title')?.closest('.wire-form-card')
  const noOpenActions = Boolean(actionSection?.querySelector('.empty'))
  setRailItemState(items[1], noOpenActions || hasActions)

  const lifeFields = form.querySelectorAll('[id^="lifeAreaStatus_"]')
  setRailItemState(items[2], lifeFields.length > 0)

  const doneCount = [...items].filter((item) => item.dataset.done === 'true').length
  const requiredCount = rail.querySelector('[data-testid="record-required-count"] .wire-badge-label')
  if (requiredCount && items.length) requiredCount.textContent = `필수 ${doneCount}/${items.length}`

  const status = rail.querySelector('[data-testid="draft-status"] .wire-badge-label')
  if (status) status.textContent = '이 탭에서만 유지'
}

function makeWriteReference(root, api, side, cleanup) {
  const form = root.querySelector('form.record-form')
  const main = root.querySelector('.record-main, .record-fields')
  const grid = root.querySelector('.record-grid, .rail-grid')
  if (!main || !grid || !side) return
  const originalParent = main.parentNode
  const originalSide = side
  const originalMainNext = main.nextSibling

  // Keep the editable DOM first; the full captured rail is still available from the sheet.
  grid.prepend(main)

  const card = document.createElement('section')
  card.className = 'proto-write-reference'
  card.setAttribute('aria-labelledby', 'proto-write-reference-title')

  const heading = document.createElement('h2')
  heading.id = 'proto-write-reference-title'
  heading.textContent = '이번 상담 목표'
  card.append(heading)

  const goal = side.querySelector('.record-rail-goal-body')
  const subgoal = side.querySelector('.record-rail-subgoal-text')
  const summary = document.createElement('p')
  summary.className = 'proto-write-reference-summary'
  summary.textContent = goal?.textContent?.trim() || subgoal?.textContent?.trim() || '등록된 상담 목표가 없습니다.'
  card.append(summary)

  let panel = null
  const trigger = api.button('상담 참고', {
    variant: 'secondary',
    onClick: () => {
      panel = api.openPanel({
        title: '상담 참고',
        content: side,
        kind: 'sheet',
        trigger,
      })
    },
  })
  trigger.setAttribute('aria-describedby', heading.id)
  card.append(trigger)

  const firstCard = main.querySelector('.wire-form-card, .wire-card')
  if (firstCard) main.insertBefore(card, firstCard)
  else main.prepend(card)

  // Moving the rail outside its captured form must not strand its original save action.
  const railSave = side.querySelector('button[type="submit"]')
  const submitFromRail = (event) => {
    event.preventDefault()
    panel?.close?.()
    if (form?.requestSubmit) form.requestSubmit()
    else form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  }
  if (railSave && form) {
    railSave.addEventListener('click', submitFromRail)
    cleanup.push(() => railSave.removeEventListener('click', submitFromRail))
  }

  cleanup.push(() => {
    panel?.close?.()
    card.remove()
    if (originalParent && originalSide.parentNode === originalParent) {
      originalParent.insertBefore(main, originalSide)
    } else if (originalParent) {
      originalParent.insertBefore(main, originalMainNext?.parentNode === originalParent ? originalMainNext : null)
    }
  })

}
function makeWriteActions(root, api, cleanup) {
  const form = root.querySelector('form.record-form')
  const main = root.querySelector('.record-main, .record-fields')
  if (!form || !main) return

  const actions = document.createElement('div')
  actions.className = 'proto-write-actions'
  actions.setAttribute('aria-label', '기록 저장')

  const status = document.createElement('p')
  status.className = 'proto-write-status'
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  status.textContent = '이 탭에서만 유지'

  const save = api.button('시안 저장', {
    variant: 'primary',
    onClick: () => {
      if (!form.reportValidity()) {
        status.textContent = '필수 항목을 확인해 주세요'
        return
      }
      form.requestSubmit()
      status.textContent = '시안에만 저장됨'
    },
  })
  // api.button creates a button for the prototype shell; submit through the captured form explicitly.
  save.type = 'button'
  actions.append(status, save)
  main.prepend(actions)

  const draftStatus = root.querySelector('[data-testid="draft-status"] .wire-badge-label')
  if (draftStatus) draftStatus.textContent = '이 탭에서만 유지'

  cleanup.push(() => actions.remove())
}

export function initWrite(root, api) {
  if (!root || !isMobilePrototype(api)) return () => {}

  const cleanup = []
  const side = root.querySelector('.record-side')
  if (!side) return () => {}

  makeWriteReference(root, api, side, cleanup)
  // Writing is the primary mobile task; keep the complete question sections
  // available below the main memo rather than making them an entrance barrier.
  const main = root.querySelector('.record-main')
  const memoCard = root.querySelector('#record-form-title')?.closest('.wire-form-card')
  const reference = root.querySelector('.proto-write-reference')
  if (main && memoCard && reference) reference.after(memoCard)
  makeWriteActions(root, api, cleanup)

  const form = root.querySelector('form.record-form')
  if (form) {
    const update = () => {
      updateWriteState(root)
      api.updateState?.('작성 중 · 이 탭에서만 유지')
    }
    on(form, 'input', update, undefined, cleanup)
    on(form, 'change', update, undefined, cleanup)
  }
  updateWriteState(root)

  return () => {
    for (let index = cleanup.length - 1; index >= 0; index -= 1) cleanup[index]()
  }
}

function consentLabel(item) {
  return item?.querySelector('.consent-checkbox span')?.textContent?.trim() || '동의서 전문'
}

export function initParticipant(root, api) {
  if (!root || !isMobilePrototype(api)) return () => {}

  const cleanup = []
  const details = root.querySelectorAll('.consent-detail')
  details.forEach((detail) => {
    const summary = detail.querySelector(':scope > .consent-detail-summary')
    const body = detail.querySelector(':scope > .consent-detail-body')
    const item = detail.closest('.consent-item')
    if (!summary || !body || !item) return

    const initialOpen = detail.open
    detail.classList.add('proto-consent-detail')
    summary.setAttribute('aria-label', `${consentLabel(item)} 전문 보기`)
    const openReadingPanel = (event) => {
      event.preventDefault()
      detail.open = false
      const panel = api.openPanel({
        title: consentLabel(item),
        content: body,
        kind: 'full',
        trigger: summary,
      })
      if (panel?.close) cleanup.push(() => panel.close())
    }
    on(summary, 'click', openReadingPanel, undefined, cleanup)
    on(summary, 'keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        openReadingPanel(event)
      }
    }, undefined, cleanup)
    cleanup.push(() => {
      detail.classList.remove('proto-consent-detail')
      if (initialOpen) detail.open = true
      summary.removeAttribute('aria-label')
    })
  })

  return () => {
    for (let index = cleanup.length - 1; index >= 0; index -= 1) cleanup[index]()
  }
}
