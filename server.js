const express = require('express');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.static(__dirname, { extensions: ['html'] }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'main.html')));

app.listen(PORT, () => console.log(`Khảo sát đang chạy tại http://localhost:${PORT} | Admin: /admin.html`));
