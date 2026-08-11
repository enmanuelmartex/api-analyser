"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAGINATOR_SCRIPT = void 0;
exports.PAGINATOR_SCRIPT = String.raw `
(function () {
  'use strict';

  var source = document.getElementById('report-source');
  var furniture = document.getElementById('report-furniture');
  var out = document.getElementById('report-pages');
  if (!source || !furniture || !out) return;

  var sheets = [];

  /** A fresh sheet with running furniture; returns its content area. */
  function newSheet() {
    var sheet = document.createElement('section');
    sheet.className = 'sheet';
    var parts = furniture.content.cloneNode(true);
    var body = document.createElement('div');
    body.className = 'pb';
    sheet.appendChild(parts.querySelector('.ph'));
    sheet.appendChild(body);
    sheet.appendChild(parts.querySelector('.pf'));
    out.appendChild(sheet);
    sheets.push(sheet);
    return body;
  }

  /* The content area is a fixed-height flex child with overflow hidden, so
     scrollHeight above clientHeight means the page is full. One pixel of slack
     absorbs sub-pixel rounding, which would otherwise spawn empty pages. */
  function overflows(body) {
    return body.scrollHeight - body.clientHeight > 1;
  }

  /** An empty copy of a block, ready to receive the part that did not fit. */
  function continuation(node) {
    var cont = document.createElement(node.tagName);
    cont.className = node.className;
    if (node.getAttribute('data-split')) cont.setAttribute('data-split', node.getAttribute('data-split'));
    cont.setAttribute('data-cont', '');
    var title = node.getAttribute('data-title');
    // Carried forward, so the third page of a long table is labelled too.
    if (title) cont.setAttribute('data-title', title);
    if (title) {
      var note = document.createElement('div');
      note.className = 'cont-note';
      note.textContent = title + ' (continued)';
      cont.appendChild(note);
    }
    return cont;
  }

  /** Trailing child blocks that do not fit, moved into a continuation. */
  function spillChildren(node, body) {
    // The "(continued)" line is furniture, not content: never spill it alone,
    // or a block one child too tall would recurse forever.
    var floor = node.querySelector(':scope > .cont-note') ? 2 : 1;
    var tail = [];
    while (node.childElementCount > floor && overflows(body)) {
      var last = node.lastElementChild;
      node.removeChild(last);
      tail.unshift(last);
    }
    if (!tail.length) {
      // One child is doing all the overflowing. If it declares how it breaks,
      // go down a level rather than clipping the whole block.
      var only = node.lastElementChild;
      if (!only || !only.getAttribute('data-split')) return null;
      var inner = only.getAttribute('data-split') === 'rows'
        ? spillRows(only, body)
        : spillChildren(only, body);
      if (!inner) return null;
      var outer = continuation(node);
      outer.appendChild(inner);
      return outer;
    }
    var cont = continuation(node);
    for (var i = 0; i < tail.length; i++) cont.appendChild(tail[i]);
    return cont;
  }

  /**
   * Trailing table rows that do not fit, moved under a repeated header.
   *
   * "keep" is the smallest number of rows worth leaving behind. Splitting a
   * table in place to strand a header and one row at the foot of a page looks
   * worse than moving the table whole, so the caller raises the floor when the
   * page already has content on it.
   */
  function spillRows(node, body, keep) {
    var table = node.querySelector('table');
    if (!table || !table.tBodies.length) return null;
    var tbody = table.tBodies[0];
    var floor = keep || 1;
    var tail = [];
    while (tbody.rows.length > floor && overflows(body)) {
      var row = tbody.rows[tbody.rows.length - 1];
      tbody.removeChild(row);
      tail.unshift(row);
    }
    // A continuation row explaining the row above it must travel with it.
    while (tail.length && tail[0].hasAttribute('data-with-prev') && tbody.rows.length > 1) {
      var owner = tbody.rows[tbody.rows.length - 1];
      tbody.removeChild(owner);
      tail.unshift(owner);
    }
    // Could not get it to fit while leaving a worthwhile stub: put it back.
    if (tail.length && overflows(body)) {
      for (var r = 0; r < tail.length; r++) tbody.appendChild(tail[r]);
      return null;
    }
    if (!tail.length) return null;

    var cont = continuation(node);
    var copy = table.cloneNode(false);
    if (table.tHead) copy.appendChild(table.tHead.cloneNode(true));
    var body2 = document.createElement('tbody');
    for (var i = 0; i < tail.length; i++) body2.appendChild(tail[i]);
    copy.appendChild(body2);
    cont.appendChild(copy);
    return cont;
  }

  /** Breaks a block that overflows a page it has to itself. */
  function split(node, body) {
    var mode = node.getAttribute('data-split');
    var rest = mode === 'rows' ? spillRows(node, body, 1)
             : mode === 'children' ? spillChildren(node, body)
             : null;
    if (!rest) return body;                 // atomic and oversized: accept the clip
    var next = newSheet();
    next.appendChild(rest);
    if (overflows(next)) return split(rest, next);
    return next;
  }

  /** Places one block, returning the content area the flow now sits in. */
  function place(node, body) {
    body.appendChild(node);
    if (!overflows(body)) return body;

    /*
     * A long table fills the page it starts on and continues overleaf, the way
     * a table in a document does. Moving it whole would leave the page it was
     * meant to start on two-thirds empty for no reason a reader can see.
     */
    if (node.getAttribute('data-split') === 'rows' && body.childElementCount > 1) {
      var spill = spillRows(node, body, 3);
      if (spill) {
        var page = newSheet();
        page.appendChild(spill);
        return overflows(page) ? split(spill, page) : page;
      }
    }

    if (body.childElementCount > 1) {
      // Carry any headings glued to this block over to the next page with it.
      var group = [node];
      var prev = node.previousElementSibling;
      while (prev && prev.hasAttribute('data-keep-next')) {
        group.unshift(prev);
        prev = prev.previousElementSibling;
      }
      // Moving everything would leave a blank page behind; split in place instead.
      if (group.length < body.childElementCount) {
        for (var i = 0; i < group.length; i++) body.removeChild(group[i]);
        var next = newSheet();
        for (var j = 0; j < group.length; j++) next.appendChild(group[j]);
        return overflows(next) ? split(node, next) : next;
      }
    }
    return split(node, body);
  }

  var items = Array.prototype.slice.call(source.content.children);
  var body = null;

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (item.hasAttribute('data-sheet')) {
      out.appendChild(item);              // already a composed page (the cover)
      sheets.push(item);
      body = null;
      continue;
    }
    if (!body || (item.getAttribute('data-start') === 'page' && body.childElementCount > 0)) {
      body = newSheet();
    }
    body = place(item, body);
  }

  // Furniture can only be numbered once the page count is known.
  for (var s = 0; s < sheets.length; s++) {
    var n = sheets[s].querySelector('.pf-n');
    var t = sheets[s].querySelector('.pf-t');
    if (n) n.textContent = String(s + 1);
    if (t) t.textContent = String(sheets.length);
  }

  // Same for the contents list, which cannot know page numbers until now.
  for (var p = 0; p < sheets.length; p++) {
    var anchors = sheets[p].querySelectorAll('[data-anchor]');
    for (var a = 0; a < anchors.length; a++) {
      var slot = out.querySelector('[data-toc-page="' + anchors[a].getAttribute('data-anchor') + '"]');
      if (slot) slot.textContent = String(p + 1);
    }
  }

  document.documentElement.setAttribute('data-paginated', String(sheets.length));
})();
`;
//# sourceMappingURL=report-paginator.js.map