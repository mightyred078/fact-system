(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function money(n) { return `$${Number(n).toFixed(2)}`; }

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function api(path, opts = {}) {
    const res = await fetch('/api/admin' + path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  // ---------------- Auth ----------------

  async function checkSession() {
    try {
      const { isAdmin } = await api('/session');
      if (isAdmin) {
        $('#login-shell').classList.add('hidden');
        $('#dashboard-shell').classList.remove('hidden');
        loadOrders();
      } else {
        $('#login-shell').classList.remove('hidden');
        $('#dashboard-shell').classList.add('hidden');
      }
    } catch (e) {
      $('#login-shell').classList.remove('hidden');
    }
  }

  async function login() {
    const username = $('#login-username').value.trim();
    const password = $('#login-password').value;
    const banner = $('#login-banner');
    banner.innerHTML = '';
    try {
      await api('/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      checkSession();
    } catch (e) {
      banner.innerHTML = `<div class="banner error">${escapeHtml(e.message)}</div>`;
    }
  }

  async function logout() {
    await api('/logout', { method: 'POST' });
    checkSession();
  }

  // ---------------- Tabs ----------------

  function switchTab(tab) {
    $$('.admin-nav [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    ['orders', 'menu', 'slots'].forEach((t) => $('#tab-' + t).classList.toggle('hidden', t !== tab));
    if (tab === 'orders') loadOrders();
    if (tab === 'menu') loadMenuAdmin();
    if (tab === 'slots') loadSlotsAdmin();
  }

  // ---------------- Orders ----------------

  const STATUS_FLOW = ['pending', 'paid', 'fulfilled', 'cancelled'];

  async function loadOrders() {
    const date = $('#orders-date-filter').value;
    const status = $('#orders-status-filter').value;
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    if (status) params.set('status', status);
    const orders = await api('/orders?' + params.toString());
    renderOrders(orders);
  }

  function renderOrders(orders) {
    const wrap = $('#orders-list');
    if (orders.length === 0) {
      wrap.innerHTML = '<p class="muted">No orders match these filters.</p>';
      return;
    }
    let html = '<table class="admin-table"><thead><tr><th>Order</th><th>Customer</th><th>Pickup</th><th>Items</th><th>Total</th><th>Pay</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
    orders.forEach((o) => {
      const itemsSummary = o.items.map((i) => `${i.quantity}× ${escapeHtml(i.name_snapshot)}`).join(', ');
      html += `<tr>
        <td><strong>${escapeHtml(o.order_code)}</strong><br><span class="muted">${new Date(o.created_at).toLocaleString()}</span></td>
        <td>${escapeHtml(o.customer_name)}<br><span class="muted">${escapeHtml(o.customer_phone)}</span></td>
        <td>${escapeHtml(o.slot_date)}<br><span class="muted">${o.start_time}–${o.end_time}</span></td>
        <td>${itemsSummary}</td>
        <td>${money(o.total_amount)}</td>
        <td>${o.payment_method}</td>
        <td><span class="status-pill status-${o.status}">${o.status}</span></td>
        <td>${renderOrderActions(o)}</td>
      </tr>`;
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;

    wrap.querySelectorAll('[data-set-status]').forEach((btn) => {
      btn.onclick = async () => {
        await api(`/orders/${btn.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ status: btn.dataset.setStatus }) });
        loadOrders();
      };
    });
    wrap.querySelectorAll('[data-notify]').forEach((btn) => {
      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = 'Sending…';
        const { sent } = await api(`/orders/${btn.dataset.id}/notify-ready`, { method: 'POST' });
        btn.textContent = sent ? 'Email sent ✓' : 'No email on file';
      };
    });
  }

  function renderOrderActions(o) {
    let html = '';
    if (o.status === 'pending') html += `<button class="icon-btn" data-set-status="paid" data-id="${o.id}">Mark paid</button>`;
    if (o.status === 'pending' || o.status === 'paid') html += `<button class="icon-btn" data-set-status="fulfilled" data-id="${o.id}">Mark fulfilled</button>`;
    if (o.status !== 'cancelled' && o.status !== 'fulfilled') html += `<button class="icon-btn" data-set-status="cancelled" data-id="${o.id}">Cancel</button>`;
    html += `<button class="icon-btn" data-notify data-id="${o.id}">Notify ready</button>`;
    return html;
  }

  // ---------------- Menu ----------------

  async function loadMenuAdmin() {
    const items = await api('/menu');
    renderMenuAdmin(items);
  }

  function renderMenuAdmin(items) {
    const wrap = $('#menu-admin-list');
    if (items.length === 0) {
      wrap.innerHTML = '<p class="muted">No menu items yet — add your first one below.</p>';
      return;
    }
    wrap.innerHTML = items.map((item) => `
      <div class="admin-card">
        <div class="row-flex" style="align-items:center;">
          <div>
            <strong>${escapeHtml(item.name)}</strong> <span class="muted">(${escapeHtml(item.category)})</span><br>
            <span class="muted">${escapeHtml(item.description || '')}</span><br>
            <span>${money(item.base_price)}</span>
            ${item.variant_groups.length ? '<br><span class="muted">' + item.variant_groups.map(g => `${escapeHtml(g.name)}: ${g.options.map(o => escapeHtml(o.label)).join(', ')}`).join(' · ') + '</span>' : ''}
          </div>
          <div style="text-align:right;">
            ${item.active ? '' : '<span class="status-pill status-cancelled">archived</span><br>'}
            <button class="icon-btn" data-edit-item="${item.id}">Edit</button>
            <button class="icon-btn" data-toggle-active="${item.id}" data-active="${item.active}">${item.active ? 'Archive' : 'Restore'}</button>
          </div>
        </div>
      </div>
    `).join('');

    wrap.querySelectorAll('[data-edit-item]').forEach((btn) => {
      btn.onclick = () => openMenuItemForm(items.find((i) => i.id === Number(btn.dataset.editItem)));
    });
    wrap.querySelectorAll('[data-toggle-active]').forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.toggleActive;
        const nowActive = btn.dataset.active === '1' ? 0 : 1;
        await api(`/menu/${id}`, { method: 'PUT', body: JSON.stringify({ active: nowActive }) });
        loadMenuAdmin();
      };
    });
  }

  let variantGroupsState = [];

  function openMenuItemForm(item) {
    variantGroupsState = item ? JSON.parse(JSON.stringify(item.variant_groups)) : [];
    const wrap = $('#menu-item-form-wrap');
    wrap.innerHTML = `
      <div class="admin-card">
        <h3 style="margin-top:0;">${item ? 'Edit item' : 'New item'}</h3>
        <div id="menu-form-banner"></div>
        <div class="row-flex">
          <div class="field"><label>Name</label><input id="mi-name" value="${item ? escapeHtml(item.name) : ''}"></div>
          <div class="field"><label>Category</label><input id="mi-category" value="${item ? escapeHtml(item.category) : 'Coffee'}" placeholder="Coffee / Tea"></div>
          <div class="field"><label>Base price (SGD)</label><input id="mi-price" type="number" step="0.10" value="${item ? item.base_price : ''}"></div>
        </div>
        <div class="field"><label>Description</label><input id="mi-desc" value="${item ? escapeHtml(item.description || '') : ''}"></div>

        <h4>Variants</h4>
        <div id="variant-groups-editor"></div>
        <button class="icon-btn" id="add-variant-group-btn">+ Add variant group (e.g. Size)</button>

        <div class="btn-row">
          <button class="btn-secondary" id="cancel-menu-form-btn">Cancel</button>
          <button class="btn-primary" id="save-menu-item-btn">${item ? 'Save changes' : 'Create item'}</button>
        </div>
      </div>
    `;
    renderVariantGroupsEditor();

    $('#add-variant-group-btn').onclick = () => {
      variantGroupsState.push({ name: '', required: true, options: [{ label: '', price_delta: 0 }] });
      renderVariantGroupsEditor();
    };
    $('#cancel-menu-form-btn').onclick = () => { wrap.innerHTML = ''; };
    $('#save-menu-item-btn').onclick = () => saveMenuItem(item ? item.id : null);
  }

  function renderVariantGroupsEditor() {
    const wrap = $('#variant-groups-editor');
    wrap.innerHTML = variantGroupsState.map((g, gi) => `
      <div class="admin-card" style="background:var(--paper);">
        <div class="row-flex">
          <div class="field"><label>Group name</label><input data-vg-name="${gi}" value="${escapeHtml(g.name)}" placeholder="Size"></div>
          <div class="field" style="flex:0 0 140px;"><label>Required?</label>
            <select data-vg-required="${gi}">
              <option value="1" ${g.required ? 'selected' : ''}>Required</option>
              <option value="0" ${!g.required ? 'selected' : ''}>Optional</option>
            </select>
          </div>
        </div>
        ${g.options.map((o, oi) => `
          <div class="row-flex">
            <div class="field"><input data-opt-label="${gi}:${oi}" value="${escapeHtml(o.label)}" placeholder="Small"></div>
            <div class="field" style="flex:0 0 110px;"><input data-opt-delta="${gi}:${oi}" type="number" step="0.10" value="${o.price_delta}" placeholder="+0.00"></div>
            <button class="icon-btn" data-remove-opt="${gi}:${oi}" type="button">✕</button>
          </div>
        `).join('')}
        <button class="icon-btn" data-add-opt="${gi}" type="button">+ Option</button>
        <button class="icon-btn" data-remove-group="${gi}" type="button">Remove group</button>
      </div>
    `).join('');

    wrap.querySelectorAll('[data-vg-name]').forEach((el) => {
      el.onchange = () => { variantGroupsState[el.dataset.vgName].name = el.value; };
    });
    wrap.querySelectorAll('[data-vg-required]').forEach((el) => {
      el.onchange = () => { variantGroupsState[el.dataset.vgRequired].required = el.value === '1'; };
    });
    wrap.querySelectorAll('[data-opt-label]').forEach((el) => {
      el.onchange = () => {
        const [gi, oi] = el.dataset.optLabel.split(':').map(Number);
        variantGroupsState[gi].options[oi].label = el.value;
      };
    });
    wrap.querySelectorAll('[data-opt-delta]').forEach((el) => {
      el.onchange = () => {
        const [gi, oi] = el.dataset.optDelta.split(':').map(Number);
        variantGroupsState[gi].options[oi].price_delta = Number(el.value) || 0;
      };
    });
    wrap.querySelectorAll('[data-add-opt]').forEach((btn) => {
      btn.onclick = () => {
        variantGroupsState[Number(btn.dataset.addOpt)].options.push({ label: '', price_delta: 0 });
        renderVariantGroupsEditor();
      };
    });
    wrap.querySelectorAll('[data-remove-opt]').forEach((btn) => {
      btn.onclick = () => {
        const [gi, oi] = btn.dataset.removeOpt.split(':').map(Number);
        variantGroupsState[gi].options.splice(oi, 1);
        renderVariantGroupsEditor();
      };
    });
    wrap.querySelectorAll('[data-remove-group]').forEach((btn) => {
      btn.onclick = () => {
        variantGroupsState.splice(Number(btn.dataset.removeGroup), 1);
        renderVariantGroupsEditor();
      };
    });
  }

  async function saveMenuItem(id) {
    const banner = $('#menu-form-banner');
    banner.innerHTML = '';
    const payload = {
      name: $('#mi-name').value.trim(),
      category: $('#mi-category').value.trim() || 'Coffee',
      base_price: Number($('#mi-price').value),
      description: $('#mi-desc').value.trim(),
      variant_groups: variantGroupsState
        .filter((g) => g.name.trim())
        .map((g) => ({ ...g, options: g.options.filter((o) => o.label.trim()) })),
    };
    if (!payload.name || isNaN(payload.base_price)) {
      banner.innerHTML = '<div class="banner error">Name and a valid price are required.</div>';
      return;
    }
    try {
      if (id) {
        await api(`/menu/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await api('/menu', { method: 'POST', body: JSON.stringify(payload) });
      }
      $('#menu-item-form-wrap').innerHTML = '';
      loadMenuAdmin();
    } catch (e) {
      banner.innerHTML = `<div class="banner error">${escapeHtml(e.message)}</div>`;
    }
  }

  // ---------------- Slots ----------------

  async function loadSlotsAdmin() {
    const slots = await api('/slots');
    renderSlotsAdmin(slots);
  }

  function renderSlotsAdmin(slots) {
    const wrap = $('#slots-list');
    if (slots.length === 0) {
      wrap.innerHTML = '<p class="muted">No pickup slots created yet.</p>';
      return;
    }
    let html = '<table class="admin-table"><thead><tr><th>Date</th><th>Time</th><th>Capacity</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
    slots.forEach((s) => {
      html += `<tr>
        <td>${escapeHtml(s.slot_date)}</td>
        <td>${s.start_time}–${s.end_time}</td>
        <td>${s.order_count}${s.max_orders ? '/' + s.max_orders : ''} orders, ${s.item_count}${s.max_items ? '/' + s.max_items : ''} items</td>
        <td>${s.active ? '<span class="status-pill status-paid">active</span>' : '<span class="status-pill status-cancelled">blocked</span>'}</td>
        <td>
          <button class="icon-btn" data-toggle-slot="${s.id}" data-active="${s.active}">${s.active ? 'Block' : 'Reactivate'}</button>
          <button class="icon-btn" data-delete-slot="${s.id}">Delete</button>
        </td>
      </tr>`;
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;

    wrap.querySelectorAll('[data-toggle-slot]').forEach((btn) => {
      btn.onclick = async () => {
        await api(`/slots/${btn.dataset.toggleSlot}`, {
          method: 'PUT',
          body: JSON.stringify({ active: btn.dataset.active === '1' ? 0 : 1 }),
        });
        loadSlotsAdmin();
      };
    });
    wrap.querySelectorAll('[data-delete-slot]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          await api(`/slots/${btn.dataset.deleteSlot}`, { method: 'DELETE' });
          loadSlotsAdmin();
        } catch (e) {
          alert(e.message);
        }
      };
    });
  }

  async function addSlot() {
    const banner = $('#slot-form-banner');
    banner.innerHTML = '';
    const payload = {
      slot_date: $('#slot-date').value,
      start_time: $('#slot-start').value,
      end_time: $('#slot-end').value,
      max_orders: Number($('#slot-max-orders').value) || 0,
      max_items: Number($('#slot-max-items').value) || 0,
    };
    if (!payload.slot_date || !payload.start_time || !payload.end_time) {
      banner.innerHTML = '<div class="banner error">Date, start time and end time are required.</div>';
      return;
    }
    try {
      await api('/slots', { method: 'POST', body: JSON.stringify(payload) });
      loadSlotsAdmin();
    } catch (e) {
      banner.innerHTML = `<div class="banner error">${escapeHtml(e.message)}</div>`;
    }
  }

  // ---------------- Wire up ----------------

  document.addEventListener('DOMContentLoaded', () => {
    checkSession();
    $('#login-btn').onclick = login;
    $('#login-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
    $('#logout-btn').onclick = logout;
    $$('.admin-nav [data-tab]').forEach((btn) => { btn.onclick = () => switchTab(btn.dataset.tab); });
    $('#orders-refresh-btn').onclick = loadOrders;
    $('#orders-date-filter').onchange = loadOrders;
    $('#orders-status-filter').onchange = loadOrders;
    $('#add-menu-item-btn').onclick = () => openMenuItemForm(null);
    $('#add-slot-btn').onclick = addSlot;
  });
})();
