let token = null;

function showRegister() {
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('register-form').style.display = 'block';
}

function showLogin() {
  document.getElementById('register-form').style.display = 'none';
  document.getElementById('login-form').style.display = 'block';
}

async function register() {
  const username = document.getElementById('reg-username').value;
  const password = document.getElementById('reg-password').value;
  const response = await fetch('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await response.json();
  alert(data.message || data.error);
  if (response.ok) showLogin();
}

async function login() {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await response.json();
  if (response.ok) {
    token = data.token;
    document.getElementById('auth').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    fetchArmoryData();
  } else {
    alert(data.error);
  }
}

async function addApiKey() {
  const apiKey = document.getElementById('api-key').value;
  const factionName = document.getElementById('faction-name').value;
  const response = await fetch('/api/api-key', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ api_key: apiKey, faction_name: factionName })
  });
  const data = await response.json();
  alert(data.message || data.error);
  if (response.ok) fetchArmoryData();
}

async function fetchArmoryData() {
  const response = await fetch('/api/armory', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await response.json();
  const tbody = document.getElementById('armory-body');
  tbody.innerHTML = '';
  data.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.faction_name}</td>
      <td>${row.username}</td>
      <td>${row.xanax}</td>
      <td>${row.beer}</td>
      <td>${row.empty_blood_bags}</td>
      <td>${row.filled_blood_bags}</td>
      <td>${row.lollipop}</td>
      <td>${row.first_aid_kit}</td>
      <td>$${row.total_value.toLocaleString()}</td>
    `;
    tbody.appendChild(tr);
  });
}
