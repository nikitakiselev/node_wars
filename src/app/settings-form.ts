/**
 * Radio groups rendered as pills.
 *
 * The options come from the same tables the match reads, so adding a board
 * size or a difficulty shows up in the dialog without touching this file.
 */
export function buildChoices(
  root: ParentNode,
  name: string,
  options: Record<string, { label: string }>,
  selected: string,
): void {
  const host = root.querySelector<HTMLElement>(`[data-choices="${name}"]`);
  if (!host) return;

  host.replaceChildren();
  for (const [value, option] of Object.entries(options)) {
    const label = document.createElement('label');
    label.className = 'choice';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = value;
    input.checked = value === selected;

    const text = document.createElement('span');
    text.textContent = option.label;

    label.append(input, text);
    host.appendChild(label);
  }
}

/** The value currently picked in a group built by buildChoices. */
export function readChoice(root: ParentNode, name: string): string {
  const checked = root.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`);
  return checked?.value ?? '';
}
