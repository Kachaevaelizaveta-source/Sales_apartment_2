const { createApp, nextTick } = Vue;

const moneyFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const clean = v => v === null || v === undefined || v === '' ? null : v;

createApp({
  data() {
    return { raw: window.salesData || [], building: 'all', view: 'all', room: 'all', discountFilter: 'all', selected: null, chart: null };
  },
  computed: {
    rows() { return this.raw.map((r, i) => ({
      flat: r['Квартира'] || `lot-${i}`, building: r['Корпус'] || '—', rooms: Number(r['Комнат']) || 0,
      area: Number(r['Площадь, м²']) || 0, view: r['Вид'] || 'Вид не указан', price: Number(r['Стоимость, руб.']) || 0,
      deal: clean(r['Сумма сделки, руб.']), sold: Number(r['Сумма сделки, руб.']) > 0,
      discount: Number(r['Скидка, руб.']) || 0, manager: r['Менеджер'] || null,
      dealDate: Number(r['Дата сделки']) || null, days: Number(r['Дней в работе']) || 0, floor: Number(r['Этаж']) || 0
    })); },
    buildings() { return [...new Set(this.rows.map(r => r.building))].sort(); },
    views() { return [...new Set(this.rows.map(r => r.view))].sort((a,b) => a.localeCompare(b, 'ru')); },
    rooms() { return ['all', ...[...new Set(this.rows.map(r => r.rooms))].sort((a,b) => a-b)]; },
    filtered() { return this.rows.filter(r => (this.building === 'all' || r.building === this.building) && (this.view === 'all' || r.view === this.view) && (this.room === 'all' || r.rooms === this.room) && (this.discountFilter === 'all' || (this.discountFilter === 'yes' ? r.discount > 0 : r.discount === 0))); },
    soldCount() { return this.filtered.filter(r => r.deal !== null && r.deal > 0).length; },
    totalRevenue() { return d3.sum(this.filtered.filter(r => r.deal !== null && r.deal > 0), r => r.deal) || 0; },
    totalDiscount() { return d3.sum(this.filtered.filter(r => r.deal !== null && r.deal > 0), r => r.discount) || 0; },
    discountShare() { return this.totalRevenue ? (this.totalDiscount / this.totalRevenue * 100).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '0,0'; },
    conversion() { return this.filtered.length ? Math.round(this.soldCount / this.filtered.length * 100) : 0; },
    medianDays() { const a = this.filtered.filter(r => r.deal && r.days).map(r => r.days).sort((x,y)=>x-y); return a.length ? Math.round(a[Math.floor(a.length/2)]) : '—'; },
    sortedRows() { return [...this.filtered].sort((a,b) => Number(b.deal !== null) - Number(a.deal !== null) || a.building.localeCompare(b.building) || a.flat.localeCompare(b.flat)); },
  },
  watch: { building: 'refresh', view: 'refresh', room: 'refresh', discountFilter: 'refresh' },
    mounted() { this.refresh(); window.addEventListener('resize', () => { this.renderChart(); this.renderSideCharts(); }); },
  methods: {
    refresh() { nextTick(() => { this.renderChart(); this.renderSideCharts(); }); },
    reset() { this.building = 'all'; this.view = 'all'; this.room = 'all'; this.discountFilter = 'all'; this.selected = null; },
    money(v) { return v ? moneyFmt.format(v) : '—'; },
    formatMillions(v) { return Math.round(v / 1000000).toLocaleString('ru-RU').replace(/\u00a0/g, ' '); },
    shortView(v) { return (v || '').replace('во двор и на реку','двор + река').replace('на реку и во двор','река + двор').replace('на улицу и во двор','улица + двор').replace('во двор и на улицу','двор + улица').replace('в окна ЖК и на улицу','окна ЖК + улица').replace('во двор и окна ЖК','двор + окна ЖК').replace('на улицу и в сад','улица + сад').replace('в сад и во двор','сад + двор'); },
    buildingColor(b) { return d3.scaleOrdinal().domain(this.buildings).range(['#276353','#f38a50','#e2ad4e','#7a8fc7','#9a6c87','#6ca7a1','#a8794f'])(b); },
    renderSideCharts() {
      const data = this.filtered;
      const sold = data.filter(d => d.deal !== null && d.deal > 0);
      const weeklyHolder = d3.select('#weekly-chart'); weeklyHolder.selectAll('*').remove();
      if (weeklyHolder.node()) {
        const toDate = serial => new Date((serial - 25569) * 86400000);
        const weekly = d3.rollups(sold.filter(d => d.dealDate), values => ({ deals:values.length, revenue:d3.sum(values, d => d.deal) || 0 }), d => +d3.utcMonday.floor(toDate(d.dealDate)))
          .map(([timestamp, stats]) => ({ date:new Date(timestamp), ...stats })).sort((a,b) => a.date - b.date);
        const width = weeklyHolder.node().clientWidth || 260, height = 168;
        const svg = weeklyHolder.append('svg').attr('viewBox', `0 0 ${width} ${height}`);
        const margin = { top:10, right:8, bottom:26, left:25 }, iw = width-margin.left-margin.right, ih = height-margin.top-margin.bottom;
        const chart = svg.append('g').attr('transform',`translate(${margin.left},${margin.top})`);
        const x = d3.scaleBand().domain(weekly.map(d => +d.date)).range([0,iw]).padding(.2);
        const yDeals = d3.scaleLinear().domain([0,d3.max(weekly,d=>d.deals)||1]).nice().range([ih,0]);
        const yRevenue = d3.scaleLinear().domain([0,d3.max(weekly,d=>d.revenue)||1]).range([ih,0]);
        chart.selectAll('.week-bar').data(weekly).join('rect').attr('class','week-bar').attr('x',d=>x(+d.date)).attr('y',d=>yDeals(d.deals)).attr('width',x.bandwidth()).attr('height',d=>ih-yDeals(d.deals)).attr('rx',2)
          .append('title').text(d=>`Неделя ${d3.utcFormat('%d.%m')(d.date)} · ${d.deals} сделок · ${this.formatMillions(d.revenue)} млн ₽`);
        chart.append('path').datum(weekly).attr('class','week-line').attr('d',d3.line().x(d=>x(+d.date)+x.bandwidth()/2).y(d=>yRevenue(d.revenue)).curve(d3.curveMonotoneX));
        chart.selectAll('.week-point').data(weekly).join('circle').attr('class','week-point').attr('cx',d=>x(+d.date)+x.bandwidth()/2).attr('cy',d=>yRevenue(d.revenue)).attr('r',2.5)
          .append('title').text(d=>`${d3.utcFormat('%d.%m')(d.date)} · ${this.formatMillions(d.revenue)} млн ₽`);
        const tickStep = Math.max(1,Math.ceil(weekly.length/5));
        chart.append('g').attr('class','mini-axis').attr('transform',`translate(0,${ih})`).call(d3.axisBottom(x).tickValues(weekly.filter((d,i)=>i%tickStep===0).map(d=>+d.date)).tickFormat(v=>d3.utcFormat('%d.%m')(new Date(v))).tickSize(0)).selectAll('text').attr('dy','1.4em');
        chart.append('g').attr('class','mini-axis').call(d3.axisLeft(yDeals).ticks(3).tickSize(-iw));
      }
      const managerHolder = d3.select('#manager-chart'); managerHolder.selectAll('*').remove();
      if (managerHolder.node()) {
        const managers = d3.rollups(sold.filter(d => d.manager), values => ({ deals:values.length, revenue:d3.sum(values, d => d.deal) || 0 }), d => d.manager)
          .map(([name, stats]) => ({ name, ...stats })).sort((a,b) => b.deals - a.deals || b.revenue - a.revenue);
        const width = managerHolder.node().clientWidth || 260, rowH = 25, height = Math.max(55, managers.length * rowH + 8);
        const svg = managerHolder.append('svg').attr('viewBox', `0 0 ${width} ${height}`);
        const maxDeals = d3.max(managers, d => d.deals) || 1;
        managers.forEach((manager, i) => {
          const y = i * rowH + 5, name = manager.name.length > 17 ? `${manager.name.slice(0,16)}…` : manager.name;
          svg.append('text').attr('x',0).attr('y',y+12).attr('fill','#71817d').attr('font-size',10).text(name);
          svg.append('rect').attr('x',92).attr('y',y+3).attr('width',Math.max(8, width-135)).attr('height',12).attr('rx',6).attr('fill','#edf0eb');
          svg.append('rect').attr('x',92).attr('y',y+3).attr('width',Math.max(8, (width-135) * manager.deals / maxDeals)).attr('height',12).attr('rx',6).attr('fill', i === 0 ? '#28775a' : '#e6a13b');
          svg.append('text').attr('x',width).attr('y',y+13).attr('text-anchor','end').attr('fill','#172321').attr('font-size',11).attr('font-weight','700').text(manager.deals);
        });
      }
    },
    aggregate() {
      const groups = d3.rollups(this.filtered, values => { const sold = values.filter(d => d.deal !== null && d.deal > 0); return { total: values.length, sold: sold.length, conversion: values.length ? sold.length / values.length * 100 : 0, area: d3.median(values, d => d.area), price: d3.median(values, d => d.price), days: d3.median(sold, d => d.days) || 0, view: values[0].view, rooms: values[0].rooms, building: values[0].building }; }, d => d.building, d => d.view, d => d.rooms);
      return groups.flatMap(([building, views]) => views.flatMap(([view, rooms]) => rooms.map(([room, x]) => ({ key: `${building}|${view}|${room}`, ...x }))));
    },
    renderChart() {
      const holder = d3.select('#demand-chart'); holder.selectAll('*').remove();
      const rows = this.filtered; if (!rows.length) return;
      const width = holder.node().clientWidth || 900;
      const buildings = this.building === 'all' ? this.buildings : [this.building];
      const margin = { top: 54, right: 8, bottom: 18, left: 44 };
      const rooms = [4,3,2,1];
      const innerW = width - margin.left - margin.right;
      const colW = innerW / buildings.length;
      const panelW = colW - 8;
      const radius = panelW < 125 ? 4.7 : 5.7;
      const step = radius * 2 + 3;
      const usableX = Math.max(24, panelW - 34);
      const perLine = Math.max(1, Math.floor(usableX / step));
      // Высота ряда зависит от фактического количества квартир.
      // Поэтому 1К и 2К больше не выходят за пределы своего блока.
      const rowHeights = rooms.map(room => {
        const maxLines = d3.max(buildings, building => {
          const count = rows.filter(d => d.building === building && d.rooms === room).length;
          return Math.max(1, Math.ceil(count / perLine));
        }) || 1;
        return Math.max(78, 46 + maxLines * step);
      });
      const innerH = d3.sum(rowHeights);
      const height = margin.top + innerH + margin.bottom;
      const svg = holder.append('svg').attr('viewBox', `0 0 ${width} ${height}`).attr('role','img');
      const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
      const palette = { fast:'#28775a', normal:'#e6a13b', slow:'#d95b4b', noDeal:'#cbd4cf' };
      const status = d => d.deal === null ? 'noDeal' : (d.days <= 7 ? 'fast' : d.days <= 14 ? 'normal' : 'slow');
      const statusLabel = d => d.deal === null ? 'Нет сделки' : (d.days <= 7 ? 'Быстро' : d.days <= 14 ? 'Нормально' : 'Долго');
      const statusRank = { fast: 0, normal: 1, slow: 2, noDeal: 3 };
      buildings.forEach((building, bi) => {
        const x0 = bi * colW + 4;
        const panel = g.append('g').attr('transform', `translate(${x0},0)`);
        panel.append('rect').attr('class','building-panel').attr('rx',8).attr('width',panelW).attr('height',innerH);
        panel.append('text').attr('class','building-title').attr('x',12).attr('y',-24).text(building);
        const buildingRows = rows.filter(d => d.building === building);
        panel.append('text').attr('class','building-subtitle').attr('x',12).attr('y',-8).text(`${buildingRows.length} квартир`);
        let y0 = 0;
        rooms.forEach((room, ri) => {
          const rowH = rowHeights[ri];
          panel.append('line').attr('class','gridline').attr('x1',0).attr('x2',panelW).attr('y1',y0).attr('y2',y0);
          panel.append('text').attr('class','room-label').attr('x',8).attr('y',y0+18).text(`${room} К`);
          const apartments = buildingRows
            .filter(d => d.rooms === room)
            .sort((a, b) => statusRank[status(a)] - statusRank[status(b)] || a.flat.localeCompare(b.flat));
          const dotGroup = panel.selectAll(`.flat-${bi}-${room}`).data(apartments, d => d.flat).join('g').attr('class', `flat-${bi}-${room}`);
          dotGroup.attr('transform', (d, i) => { const col = i % perLine, line = Math.floor(i / perLine); return `translate(${28 + col * step},${y0 + 34 + line * step})`; });
          dotGroup.append('circle').attr('class','flat-dot').attr('r',radius).attr('fill',d => palette[status(d)]).on('click', (e,d) => { this.selected = { ...d, total:1, sold:d.deal !== null ? 1 : 0, conversion:d.deal !== null ? 100 : 0, key:d.flat }; });
          dotGroup.append('title').text(d => `${d.flat} · ${d.rooms} комн. · ${statusLabel(d)}${d.deal !== null ? ` · ${d.days} дней` : ''}`);
          y0 += rowH;
        });
      });
      g.append('text').attr('class','room-label').attr('x',-42).attr('y',innerH/2).attr('transform',`rotate(-90,-42,${innerH/2})`).text('КОМНАТЫ');
    }
  }
}).mount('#app');
