# Работа с библиотекой

Рабочая папка: G:\книги наташа\knigi_natasha.
Remote: https://github.com/NikitaZhilin/book_NZMZ.git, ветка main.

- Сохранять исходный каталог. Не коммитить каталоги, seed.json, обложки, data, backups, пароли, токены и ключи.
- Проверки: python -m unittest discover -s tests -v и node --check prototype/app.js.
- Пользователь разрешил автоматическую отправку проверенных изменений в GitHub и деплой. После завершённого изменения выполнять проверки, commit и push в main. Не делать force push.
- Перед ручной работой с git остановить локальный наблюдатель через STOP_AUTO_PUBLISH.cmd, после push возобновить START_AUTO_PUBLISH.cmd.
- GitHub Actions проверяет код; отдельная служба сервера забирает прошедший проверки SHA. Проверять workflow и /health сервера.
- Рабочие данные сервера: /var/lib/book-nzmz, отдельно от кода. Деплой не должен заменять их исходным каталогом.
- VPN и существующий Telegram-бот не относятся к проекту: их настройки не менять.
