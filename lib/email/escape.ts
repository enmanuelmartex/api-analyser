const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapes text before it is interpolated into the email template.
 *
 * The relay never accepts HTML from a caller — the template is entirely
 * server-owned — but it does accept a scan name, and a scan name is whatever
 * someone typed into a project form. This is what keeps `<img onerror=…>` in a
 * project title from becoming markup in a mail sent from a verified security
 * domain.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ENTITIES[character] ?? character);
}
