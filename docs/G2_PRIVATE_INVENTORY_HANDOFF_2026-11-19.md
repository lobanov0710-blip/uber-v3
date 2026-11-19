# Вариант A: закрытая инвентаризация STAGING

Владелец утвердил вариант A 2026-11-19. Отдельный Windows CLI читает только
согласованные метаданные STAGING и один фиксированный SELECT с 18 счётчиками.
Утверждение не включает выгрузку SQLite, изменение данных, выдачу прав,
миграции, активацию классификатора, merge или deploy.

Исходник пакета: `6df1c9f051fc415f1152aa1e1bce7e7130f9e952`. Tree: `8bd6908373445780ae7fc99dae68864baee9a6ef`.
Backend Draft PR47; Android companion содержит только документацию.

SHA256 архива `vehicle-inventory-readonly.zip`:

```text
039625742f17d80712932e20b58a2f6bba50db8f518bb3a4a699d502aa3431c5
```

Пакет содержит 16 файлов, из них 15 закреплены в release manifest. В нём нет
credentials, локального target config, Worker source, provisioning CLI,
миграций DDL, тестовых fixtures или отчётов. Зависимости закреплены lockfile;
установка выполняется с `--ignore-scripts`. Для доступа используется
существующая приватная авторизация Cloudflare владельца.

## Запуск владельцем

[Подробная инструкция Windows](VEHICLE_INVENTORY_WINDOWS.md). Распаковать ZIP
в новую отдельную папку, перейти в `vehicle-inventory-readonly`, затем:

```powershell
npm ci --ignore-scripts
node .\scripts\vehicleInventoryRead.mjs init
node .\scripts\vehicleInventoryRead.mjs read
```

Фраза подтверждения: `READ STAGING VEHICLE METRICS`. При отсутствии авторизации
или ошибке сообщить только имя этапа; не расширять права самостоятельно.
После `READ_ONLY_COMPLETE` отправить только `receipt.public.json` из новой
папки `%USERPROFILE%\TransferDriver-Inventory-*`. `metrics.private.json`
остаётся у владельца. Квитанция не содержит чисел или хеша закрытого отчёта.

## Проверка и границы

Состояние CI и проверки артефакта записываются в
[машинную квитанцию](PRIVATE_VEHICLE_INVENTORY_VERIFICATION_2026-11-19.json).
История обнаруженных ошибок и исправлений сохранена в журнале.

Реальная STAGING база в среде разработчика не читалась. Чтение владельцем
на Windows и рассмотрение закрытых чисел ещё предстоят. Квитанция подтверждает
формат и выполнение чтения, а не фактическую готовность автомобилей к линии.
Full classifier readiness остаётся открытой: 111 range followups, отдельная
обработка пробелов inventory. G1 на паузе, D4–D7 требуют прежних отдельных решений.
