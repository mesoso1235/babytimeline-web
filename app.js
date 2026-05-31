fetch('data.json')
  .then(response => response.json())
  .then(data => {
    const timeline = document.getElementById('timeline');
    data.forEach(item => {
      const card = document.createElement('div');
      card.className = 'card timeline-item';
      card.innerHTML = `
        <span><strong>第 ${item.week} 週</strong>（${item.age}）</span>
        <span class="date">${item.date}</span>
      `;
      // クリックで詳細はなし、デモ用
      timeline.appendChild(card);
    });
  })
  .catch(err => console.error('データ取得エラー', err));
