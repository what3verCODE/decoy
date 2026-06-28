---
pageType: home
description: Decoy — быстрый HTTP-мок по принципу «сначала контракт»: укажите базовый URL и тестируйте на детерминированных fail-closed сценариях, не дожидаясь бэкенда.

hero:
  name: Decoy
  text: HTTP-мок по принципу «сначала контракт» — просто укажите базовый URL
  tagline: Разрабатывайте и тестируйте на детерминированных сценариях, не дожидаясь бэкенда.
  actions:
    - theme: brand
      text: Введение
      link: /ru/guide/start/introduction
    - theme: alt
      text: GitHub
      link: https://github.com/what3verCODE/decoy

features:
  - title: Fail-closed по умолчанию
    details: Несовпавший запрос возвращает ошибку, а не молча уходит в реальный API. Тест не сможет случайно достучаться до прода.
    icon: 🔒
  - title: Детерминированное сопоставление
    details: Маршруты группируются в переключаемые коллекции. Один и тот же запрос всегда даёт один и тот же вариант.
    icon: 🎯
  - title: Множество адаптеров
    details: Фикстуры для Playwright и Testplane, middleware для Express, Nest и Fastify, отдельный сервер и CLI.
    icon: 🔌
  - title: Изоляция сессий
    details: Параллельные тесты выбирают свою коллекцию через заголовок x-mock-session — без общего состояния.
    icon: 🧪
---
