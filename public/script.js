let apiKey = localStorage.getItem('apiKey');

if (apiKey) {
  document.getElementById('auth').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  fetchArmoryData();
}

async function addApiKey() {
  const apiKey = document.getElementById('api-key').value;
  const factionName = document.getElementById('faction-name').value;
  const response = await fetch('/api/api-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, faction_name: factionName })
  });
  const data = await response.json();
  if (response.ok) {
    localStorage.setItem('apiKey', apiKey);
    document.getElementById('auth').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    fetchArmoryData();
  } else {
    alert(data.error);
  }
}

async function fetchArmoryData() {
  const response = await fetch('/api/armory', {
    headers: { 'X-API-Key': apiKey }
  });
  const data = await response.json();
  if (response.ok) {
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
        <td>$${row.total_value.toLocaleThis is an incomplete response due to the character limit. Below, I'll continue the response to complete the code and provide further instructions.

---

```javascript
        <td>$${row.total_value.toLocaleString()}</td>
      `;
      tbody.appendChild(tr);
    });
  } else {
    alert(data.error);
    localStorage.removeItem('apiKey');
    document.getElementById('auth').style.display = 'block';
    document.getElementById('app').style.display = 'none';
  }
}
