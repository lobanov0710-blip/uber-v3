# G2: силовые исполнения по датам и рынкам — 2026-11-19

Продолжение утверждённого плана после liftback/QA checkpoint. Уточнены десять
семейств со смешанными исполнениями: 18 первичных источников, 20 ограниченных
наблюдений. Это углубление первого прохода, а не полное закрытие всех диапазонов.
[Машиночитаемый реестр](VEHICLE_POWERTRAIN_RANGES_2026-11-19.json) сохраняет точные
даты, рынки, доступность первичного текста, ссылки и открытые пробелы.

Каталог по-прежнему 121 строка (76 Комфорт/22 Бизнес/23 Минивэн), SHA256
`553384af5b49252d3b3acbc3973ef6dae7fc40d348156debf4f0fab24c5ae880`.
Архив 116 строк сохранён. Новые модели/aliases/минимальные годы/классы/условия
не вводились. Остальные 111 строк сохраняют результаты первого прохода revision 2.
Исчерпывающе проверенных диапазонов по всем годам/поколениям/рынкам всё ещё **0**.

## Подтверждённые наблюдения и пределы

| Модель / утверждённый минимум | Датированное первичное наблюдение | Что ещё не доказано |
| --- | --- | --- |
| Avatr 12 / 2023 | [Changan, PDF стр. 2](https://static.cninfo.com.cn/finalpage/2024-11-15/1221742345.PDF): запуск двух силовых версий 02.11.2024; [текущая таблица](https://www.avatr.com/configuration?car=12) различает гибрид/BEV | Гибридный автомобиль фактического выпуска 2023 года; весь диапазон версий/рынков |
| Stelato S9 / 2023 | [BAIC](https://www.baicgroup.com.cn/baicgroup/News/NewsShort/2026/1/I1457793774959722496.html): REEV в продаже 16.04.2025; [HIMA](https://hima.auto/xiangjie/s9/configuration/) отдельно EVR/EV | Исполнения автомобилей фактического выпуска 2023/2024 и все рынки |
| Exlantix ES / 2023 | [EXEED Kazakhstan, 30.04.2025](https://exeed.kz/ru/news/131/): ES BEV/REEV; [EXEED Russia, 17.07.2025](https://exeed.ru/news/exeed-exlantix-es-is-available-for-pre-orders/): предзаказ гибрида | Весь 2023+ диапазон; точный сертифицированный кузов, несмотря на маркетинговое «купе»/«седан» |
| Voyah Passion / 2023 | [Dongfeng, 07.12.2023](https://www.dfmc.com.cn/news/company/news_20231207_1516.html): китайский PHEV запущен 05.12.2023 (первичный индексированный фрагмент); [VOYAH Russia, 27.06.2025](https://voyah.ru/news/voyah-obuyavlyaet-specifikacii-na-novyj-gibridnyj-sedan-s-uvelichennym-zapasom-hoda-voyah-passion-evr): российский EVR | Нельзя переносить дату российского EVR на все китайские PHEV; ранний год конкретного авто требует документов |
| BYD Han / 2022 | [Отчёт BYD за 2022, PDF стр. 77–78](https://www1.hkexnews.hk/listedco/listconews/sehk/2023/0328/2023032801987.pdf): DM-i/DM-p; тот же отчёт отдельно описывает HAN EV для Чили | Нельзя считать Han одного рынка/года доказательством всех исполнений |
| Voyah Dream / 2022 | [Dongfeng, 09.05.2022](https://www.dfmc.com.cn/news/company/news_20220509_1048.html): запуск 07.05.2022, гибридная low-carbon и электрическая zero-carbon версии | Все региональные комплектации и фактические годы конкретных авто |
| Denza D9 / 2023 | [BYD, PDF стр. 13](https://www1.hkexnews.hk/listedco/listconews/sehk/2023/0328/2023032801987.pdf): запуск модели 23.08.2022, без определения всех силовых версий; [BYD Europe](https://media.byd.com/denza-brings-super-hybrid-tech-to-mpv-segment-with-d9-dm-i-475599/?lang=eng): гибридный DM-i в 2026 | Дата запуска модели не доказывает китайский гибрид 2023 года; на европейской странице конфликт дат header/body |
| Lexus ES / 2020 | [Lexus France, PDF стр. 5](https://media.lexus.fr/download/919569/1-tariflexusndeg1087au01septembre2020.pdf): прайс 01.09.2020, ES 300h MY20/MY21; [Lexus Europe, 27.05.2026](https://newsroom.lexus.eu/the-all-new-lexus-es-redefining-the-luxury-sedan/): восьмое поколение HEV/BEV | Model year/дата прайса не равны году изготовления; поколения и все годы не закрыты |
| Citroën SpaceTourer / 2019 | [Citroën](https://www.media.stellantis.com/em-en/citroen/press/citroen-focuses-its-passenger-car-offer-on-e-berlingo-and-e-spacetourer-to-accelerate-the-electrification-of-its-range): с января 2022 BEV-only для новых частных заказов в Европе, с оговорками; [Citroën UK, 29.08.2025](https://www.media.stellantis.com/uk-en/citroen/press/citroen-broadens-powertrain-choice-on-spacetourer-berlingo-with-introduction-of-petrol-diesel-variants): дизель объявлен на осень | Это не глобальный запрет ДВС по году выпуска. Бензин в новой статье относится к Berlingo; utility-версии не становятся пассажирскими автоматически |
| Opel Zafira Life / 2019 | [Opel, 06.01.2022](https://www.media.stellantis.com/em-en/opel/press/e-for-emissions-free-opel-with-consistent-focus-on-electrification): электрическое предложение новых заказов; [Opel Italy, PDF стр. 1–2](https://www.opel.it/content/dam/opel/italia/pdf/Listino_Zafira_giugno_2025.pdf): точное имя Life, MY24-K0, дизель/BEV в прайсе 20.06.2025 | Не все 2019+ рынки/годы; MY24 не доказывает изготовление в 2024. Business Edition — имя комплектации, не тариф проекта |

Наличие режима EV у гибрида само по себе не делает его BEV. Маркетинговый
термин кузова и шильдик гибридной версии не заменяют документы автомобиля.
Связь Zhuiguang/Passion установлена публикацией производителя только для
сопоставления источников; runtime alias не создаётся.

## Ограничения получения доказательств

Прямое получение декабрьской страницы Dongfeng дважды завершилось timeout;
для неё используется только явно помеченный первичный индексированный фрагмент.
Австрийский PDF SpaceTourer 2024 вернул 404: доказательство дизеля 2024 из него
не извлекалось. Историческая новость AVATR в текущем rendering вернула оболочку
меню: она не использована для доказательства года производства. Просмотр отдельных
фрагментов PDF не заявляется чтением всех страниц. Служебные footer identifiers
публичных сайтов в реестр/журнал/артефакты не переносятся.

## Следствие для существующего порядка

Проект уже требует проверку конкретного powertrain, года, кузова и документов.
BEV исключён, неизвестные/неподходящие параметры идут на ручную проверку по
утверждённому контракту. Нынешняя гибридная версия не разрешает произвольный
ранний год; отсутствие найденной публикации не доказывает запрет такого года.
Поэтому этот проход не меняет минимумы и не назначает автоматический допуск.

Историческое ожидание решения о liftback в revision 2 superseded: владелец
утвердил **только Комфорт**, поправка проверена в backend/Android. Бизнес остаётся
седаном с уже утверждёнными crossover-исключениями Li Auto L7/L9. Лифтбек в Бизнесе
и Минивэне запрещён; Dispatcher новых прав не получает, actual OWNER/MFA обязателен.

## Следующий доступ к реальным данным

Владелец подтвердил отсутствие SQLite-снимка и попросил подготовить порядок.
[План закрытого чтения](VEHICLE_LEGACY_INVENTORY_READ_PLAN_2026-11-19.md) предлагает
18 скалярных метрик внутри D1 и закрытый JSON на Windows. Удалённые запросы,
экспорт и новые provider credentials сейчас не использовались. Пять точных SQL
профилей проверены на синтетических схемах; новый remote CLI ещё не реализован.
Полный powertrain review/actual legacy inventory/план устранения пробелов и
отдельная активация остаются открытыми. G1paused; D4–D7pending.
