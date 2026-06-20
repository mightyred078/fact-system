(function () {
  'use strict';

  const state = {
    menu: [],
    categories: [],
    activeCategory: null,
    openItemId: null,
    selections: {}, // itemId -> { optionsByGroup: {groupId: optionId}, qty }
    cart: [], // { menu_item_id, name, unit_price, quantity, selected_option_ids, variant_summary, line_total }
    slots: [],
    selectedDate: null,
    selectedSlotId: null,
    paymentMethod: 'pickup',
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function money(n) {
    return `$${Number(n).toFixed(2)}`;
  }

  function showView(id) {
    ['view-menu', 'view-checkout', 'view-confirmation', 'view-track'].forEach((v) => {
      $('#' + v).classList.toggle('hidden', v !== id);
    });
    $('#cart-bar').classList.toggle('hidden', id !== 'view-menu' || cartCount() === 0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cartCount() {
    return state.cart.reduce((sum, l) => sum + l.quantity, 0);
  }

  function cartTotal() {
    return state.cart.reduce((sum, l) => sum + l.line_total, 0);
  }

  function updateCartBar() {
    const count = cartCount();
    $('#cart-bar').classList.toggle('hidden', count === 0);
    $('#cart-summary').textContent = `${count} item${count === 1 ? '' : 's'} — ${money(cartTotal())}`;
  }

  // ---------------- Menu ----------------

  async function loadMenu() {
    const res = await fetch('/api/menu');
    state.menu = await res.json();
    state.categories = [...new Set(state.menu.map((i) => i.category))];
    state.activeCategory = state.categories[0] || null;
    renderTabs();
    renderMenu();
  }

  function renderTabs() {
    const wrap = $('#category-tabs');
    wrap.innerHTML = '';
    state.categories.forEach((cat) => {
      const btn = document.createElement('button');
      btn.className = 'tab' + (cat === state.activeCategory ? ' active' : '');
      btn.textContent = cat;
      btn.onclick = () => {
        state.activeCategory = cat;
        renderTabs();
        renderMenu();
      };
      wrap.appendChild(btn);
    });
  }

  function renderMenu() {
    const wrap = $('#menu-list');
    wrap.innerHTML = '';
    const items = state.menu.filter((i) => i.category === state.activeCategory);

    if (items.length === 0) {
      wrap.innerHTML = '<p class="muted center">Nothing here right now — check back soon.</p>';
      return;
    }

    items.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'item-card';

      const row = document.createElement('div');
      row.className = 'item-row';
      row.innerHTML = `
        <div>
          <div class="item-name">${escapeHtml(item.name)}</div>
          ${item.description ? `<div class="item-desc">${escapeHtml(item.description)}</div>` : ''}
        </div>
        <div class="item-price">${money(item.base_price)}</div>
      `;
      row.onclick = () => {
        state.openItemId = state.openItemId === item.id ? null : item.id;
        if (state.openItemId && !state.selections[item.id]) {
          state.selections[item.id] = { optionsByGroup: {}, qty: 1 };
        }
        renderMenu();
      };
      card.appendChild(row);

      if (state.openItemId === item.id) {
        card.appendChild(renderItemDetail(item));
      }
      wrap.appendChild(card);
    });
  }

  function renderItemDetail(item) {
    const sel = state.selections[item.id] || { optionsByGroup: {}, qty: 1 };
    state.selections[item.id] = sel;

    const detail = document.createElement('div');
    detail.className = 'item-detail';

    item.variant_groups.forEach((group) => {
      const g = document.createElement('div');
      g.className = 'variant-group';
      g.innerHTML = `<div class="variant-group-name">${escapeHtml(group.name)}${group.required ? '' : ' (optional)'}</div>`;
      const opts = document.createElement('div');
      opts.className = 'variant-options';
      group.options.forEach((opt) => {
        const pill = document.createElement('button');
        pill.type = 'button';
        const isSelected = sel.optionsByGroup[group.id] === opt.id;
        pill.className = 'variant-pill' + (isSelected ? ' selected' : '');
        const deltaLabel = opt.price_delta ? ` (${opt.price_delta > 0 ? '+' : ''}${opt.price_delta.toFixed(2)})` : '';
        pill.textContent = opt.label + deltaLabel;
        pill.onclick = () => {
          sel.optionsByGroup[group.id] = isSelected && !group.required ? undefined : opt.id;
          renderMenu();
        };
        opts.appendChild(pill);
      });
      g.appendChild(opts);
      detail.appendChild(g);
    });

    const qtyRow = document.createElement('div');
    qtyRow.className = 'qty-row';
    qtyRow.innerHTML = `
      <button type="button" class="qty-btn" data-dir="-1">−</button>
      <span>${sel.qty}</span>
      <button type="button" class="qty-btn" data-dir="1">+</button>
    `;
    qtyRow.querySelectorAll('.qty-btn').forEach((btn) => {
      btn.onclick = () => {
        const dir = parseInt(btn.dataset.dir, 10);
        sel.qty = Math.max(1, sel.qty + dir);
        renderMenu();
      };
    });
    detail.appendChild(qtyRow);

    const missingRequired = item.variant_groups.some((g) => g.required && !sel.optionsByGroup[g.id]);

    const addBtn = document.createElement('button');
    addBtn.className = 'add-btn';
    addBtn.textContent = missingRequired ? 'Choose options above' : `Add to order — ${money(computeUnitPrice(item, sel) * sel.qty)}`;
    addBtn.disabled = missingRequired;
    addBtn.style.opacity = missingRequired ? '0.55' : '1';
    addBtn.onclick = (e) => {
      e.stopPropagation();
      addToCart(item, sel);
      state.openItemId = null;
      renderMenu();
      updateCartBar();
    };
    detail.appendChild(addBtn);

    return detail;
  }

  function computeUnitPrice(item, sel) {
    let price = item.base_price;
    item.variant_groups.forEach((g) => {
      const optId = sel.optionsByGroup[g.id];
      if (optId) {
        const opt = g.options.find((o) => o.id === optId);
        if (opt) price += opt.price_delta;
      }
    });
    return price;
  }

  function addToCart(item, sel) {
    const selectedOptionIds = [];
    const labels = [];
    item.variant_groups.forEach((g) => {
      const optId = sel.optionsByGroup[g.id];
      if (optId) {
        const opt = g.options.find((o) => o.id === optId);
        if (opt) {
          selectedOptionIds.push(opt.id);
          labels.push(opt.label);
        }
      }
    });
    const unitPrice = computeUnitPrice(item, sel);
    state.cart.push({
      menu_item_id: item.id,
      name: item.name,
      unit_price: unitPrice,
      quantity: sel.qty,
      selected_option_ids: selectedOptionIds,
      variant_summary: labels.join(', '),
      line_total: Math.round(unitPrice * sel.qty * 100) / 100,
    });
    state.selections[item.id] = { optionsByGroup: {}, qty: 1 };
  }

  function removeFromCart(index) {
    state.cart.splice(index, 1);
    updateCartBar();
    renderCheckoutSummary();
  }

  // ---------------- Checkout ----------------

  async function openCheckout() {
    showView('view-checkout');
    $('#checkout-banner').innerHTML = '';
    renderCheckoutSummary();
    await loadSlots();
  }

  async function loadSlots() {
    const res = await fetch('/api/slots');
    state.slots = await res.json();
    const dates = [...new Set(state.slots.map((s) => s.slot_date))];
    state.selectedDate = state.selectedDate && dates.includes(state.selectedDate) ? state.selectedDate : dates[0] || null;
    renderDayList(dates);
    renderSlotGrid();
  }

  function renderDayList(dates) {
    const wrap = $('#day-list');
    wrap.innerHTML = '';
    if (dates.length === 0) {
      wrap.innerHTML = '<p class="muted">No pickup slots are open right now — please check back later.</p>';
      return;
    }
    dates.forEach((d) => {
      const chip = document.createElement('button');
      chip.className = 'day-chip' + (d === state.selectedDate ? ' active' : '');
      chip.textContent = formatDate(d);
      chip.onclick = () => {
        state.selectedDate = d;
        state.selectedSlotId = null;
        renderDayList(dates);
        renderSlotGrid();
      };
      wrap.appendChild(chip);
    });
  }

  function formatDate(isoDate) {
    const d = new Date(isoDate + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function renderSlotGrid() {
    const wrap = $('#slot-grid');
    wrap.innerHTML = '';
    const slots = state.slots.filter((s) => s.slot_date === state.selectedDate);
    slots.forEach((s) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'slot-chip' + (s.is_full ? ' full' : '') + (s.id === state.selectedSlotId ? ' selected' : '');
      const leftLabel = s.is_full
        ? 'Full'
        : [s.orders_left !== null ? `${s.orders_left} slots left` : null, s.items_left !== null ? `${s.items_left} items left` : null]
            .filter(Boolean)
            .join(' · ') || 'Open';
      chip.innerHTML = `<div class="slot-time">${s.start_time}–${s.end_time}</div><div class="slot-left">${leftLabel}</div>`;
      chip.disabled = s.is_full;
      chip.onclick = () => {
        state.selectedSlotId = s.id;
        renderSlotGrid();
      };
      wrap.appendChild(chip);
    });
  }

  function renderCheckoutSummary() {
    const wrap = $('#checkout-summary');
    if (state.cart.length === 0) {
      wrap.innerHTML = '<p class="muted">Your order is empty.</p>';
      return;
    }
    let html = `<div class="ticket-title"><span>FACT ORDER</span><span>${state.cart.length} item${state.cart.length === 1 ? '' : 's'}</span></div>`;
    state.cart.forEach((l, idx) => {
      html += `<div class="ticket-line"><span>${l.quantity}× ${escapeHtml(l.name)}${l.variant_summary ? ' (' + escapeHtml(l.variant_summary) + ')' : ''} <a href="#" data-remove="${idx}" style="margin-left:6px;">remove</a></span><span>${money(l.line_total)}</span></div>`;
    });
    html += `<div class="ticket-total"><span>Total</span><span>${money(cartTotal())}</span></div>`;
    wrap.innerHTML = html;
    wrap.querySelectorAll('[data-remove]').forEach((a) => {
      a.onclick = (e) => {
        e.preventDefault();
        removeFromCart(parseInt(a.dataset.remove, 10));
      };
    });
  }

  async function placeOrder() {
    const banner = $('#checkout-banner');
    banner.innerHTML = '';

    const name = $('#cust-name').value.trim();
    const phone = $('#cust-phone').value.trim();
    const email = $('#cust-email').value.trim();
    const notes = $('#cust-notes').value.trim();

    if (state.cart.length === 0) return setBanner(banner, 'Your order is empty.');
    if (!name || !phone) return setBanner(banner, 'Please enter your name and phone number.');
    if (!email) return setBanner(banner, 'Please enter your email so we can send your order confirmation.');
    if (!state.selectedSlotId) return setBanner(banner, 'Please choose a pickup slot.');

    const payload = {
      customer_name: name,
      customer_phone: phone,
      customer_email: email || null,
      slot_id: state.selectedSlotId,
      payment_method: state.paymentMethod,
      notes,
      items: state.cart.map((l) => ({
        menu_item_id: l.menu_item_id,
        quantity: l.quantity,
        selected_option_ids: l.selected_option_ids,
      })),
    };

    $('#place-order-btn').disabled = true;
    $('#place-order-btn').textContent = 'Placing order…';

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner(banner, data.error || 'Something went wrong. Please try again.');
        await loadSlots(); // refresh in case the slot filled up
        return;
      }
      renderConfirmation(data);
      state.cart = [];
      updateCartBar();
      showView('view-confirmation');
    } catch (err) {
      setBanner(banner, 'Could not reach the server. Please check your connection and try again.');
    } finally {
      $('#place-order-btn').disabled = false;
      $('#place-order-btn').textContent = 'Place order';
    }
  }

  function setBanner(el, msg) {
    el.innerHTML = `<div class="banner error">${escapeHtml(msg)}</div>`;
  }

  function renderConfirmation(data) {
    const wrap = $('#confirmation-ticket');
    let html = `<div class="ticket-title"><span>${escapeHtml(data.order_code)}</span><span>${escapeHtml(data.slot.date)}</span></div>`;
    html += `<div class="ticket-line"><span>Pickup window</span><span>${data.slot.start_time}–${data.slot.end_time}</span></div>`;
    data.items.forEach((i) => {
      html += `<div class="ticket-line"><span>${i.quantity}× ${escapeHtml(i.name_snapshot)}${i.variant_summary ? ' (' + escapeHtml(i.variant_summary) + ')' : ''}</span><span>${money(i.line_total)}</span></div>`;
    });
    html += `<div class="ticket-total"><span>Total</span><span>${money(data.total_amount)}</span></div>`;
    html += `<p class="muted" style="margin-top:10px;">${data.payment_method === 'paynow' ? 'Scan the QR below to pay now.' : 'Pay when you collect your order.'} Keep your order reference and phone number handy to track your order.</p>`;
    wrap.innerHTML = html;

    const qrWrap = $('#confirmation-qr');
    if (data.qr_data_url) {
      qrWrap.classList.remove('hidden');
      qrWrap.innerHTML = `<img src="${data.qr_data_url}" alt="PayNow QR code" width="220" height="220"><p class="muted">Scan with your banking app — amount is pre-filled.</p>`;
    } else {
      qrWrap.classList.add('hidden');
      qrWrap.innerHTML = '';
    }
  }

  // ---------------- Track order ----------------

  async function trackOrder() {
    const code = $('#track-code').value.trim();
    const phone = $('#track-phone').value.trim();
    const resultEl = $('#track-result');
    const banner = $('#track-banner');
    banner.innerHTML = '';
    resultEl.innerHTML = '';

    if (!code || !phone) {
      banner.innerHTML = '<div class="banner error">Please enter both your order reference and phone number.</div>';
      return;
    }

    try {
      const res = await fetch(`/api/orders/lookup?code=${encodeURIComponent(code)}&phone=${encodeURIComponent(phone)}`);
      const data = await res.json();
      if (!res.ok) {
        banner.innerHTML = `<div class="banner error">${escapeHtml(data.error)}</div>`;
        return;
      }
      let html = `<div class="ticket"><div class="ticket-body">`;
      html += `<div class="ticket-title"><span>${escapeHtml(data.order_code)}</span><span class="status-pill status-${data.status}">${data.status}</span></div>`;
      if (data.slot) html += `<div class="ticket-line"><span>Pickup</span><span>${escapeHtml(data.slot.date)}, ${data.slot.start_time}–${data.slot.end_time}</span></div>`;
      data.items.forEach((i) => {
        html += `<div class="ticket-line"><span>${i.quantity}× ${escapeHtml(i.name_snapshot)}${i.variant_summary ? ' (' + escapeHtml(i.variant_summary) + ')' : ''}</span><span>${money(i.line_total)}</span></div>`;
      });
      html += `<div class="ticket-total"><span>Total</span><span>${money(data.total_amount)}</span></div>`;
      html += `</div></div>`;
      resultEl.innerHTML = html;
    } catch (err) {
      banner.innerHTML = '<div class="banner error">Could not reach the server. Please try again.</div>';
    }
  }

  // ---------------- Utils ----------------

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------------- Wire up ----------------

  document.addEventListener('DOMContentLoaded', () => {
    loadMenu();

    $('#review-order-btn').onclick = openCheckout;
    $('#back-to-menu').onclick = () => showView('view-menu');
    $('#back-to-menu-from-track').onclick = (e) => { e.preventDefault(); showView('view-menu'); };
    $('#track-link').onclick = (e) => { e.preventDefault(); showView('view-track'); };
    $('#track-btn').onclick = trackOrder;
    $('#place-order-btn').onclick = placeOrder;
    $('#new-order-btn').onclick = () => {
      state.selectedSlotId = null;
      showView('view-menu');
    };

    $$('[data-pay]').forEach((btn) => {
      btn.onclick = () => {
        state.paymentMethod = btn.dataset.pay;
        $$('[data-pay]').forEach((b) => b.classList.toggle('selected', b === btn));
      };
    });

    updateCartBar();
  });
})();
