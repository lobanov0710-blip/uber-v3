# Проверка полностью электрических моделей — 2026-11-17

Владелец: «Другие только электромобили — исключить из списка». Исключаются
полностью электрические исполнения; гибрид с бензиновым ДВС не приравнивается
к такому исполнению. Исключение Li Auto L7/L9 в Бизнесе сохраняется.

## Выполнено: подтверждённые текущие полностью электрические модели

Из CSV удалены 10 строк: Mercedes-Benz EQS, BMW i5, BMW i7, NIO ET7, IM Motors
L7, Luxeed S7, Xpeng P7, Xiaomi SU7, Zeekr 001 и Zeekr 009. Источники:

- [Mercedes-Benz EQS](https://media.mercedes-benz.com/en/article/c57e6e74-61a7-42a0-a764-31a14aeeb057);
- [BMW i5 и i7](https://www.press.bmwgroup.com/united-kingdom/article/detail/T0457515EN_GB/bmw-group-produces-its-two-millionth-all-electric-vehicle);
- [NIO ET7](https://www.nio.com/et7), [IM Motors L7](https://www.immotors.com/global/en/l7_detail);
- [Luxeed S7](https://cnautohr.com/models/luxeed/s7/), [Xpeng P7](https://www.xpeng.com/news/0188fff005f788fa98d62c9e8d790026);
- [Xiaomi SU7](https://ir.mi.com/static-files/bdeea0b9-246c-45be-8cb4-ab4faaddf80a),
  [Zeekr 001](https://www.zeekrgroup.com/en/about), [Zeekr 009](https://www.zeekrlife.com/global/vehicles/009/).

Это проверка по доступным источникам на дату работы, не запрет возможных
будущих гибридных исполнений. Есть [сообщение о планируемом гибридном Zeekr 009](https://carnewschina.com/2026/11/16/geelys-luxury-minivan-zeekr-009-will-get-a-plug-in-hybrid-system/):
планы не подтверждают существующее допущенное исполнение, при его появлении
понадобится отдельная проверка и решение о включении.

## Смешанные версии: не удалять гибрид вместе с электрической версией

Voyah Passion предлагается в [гибридной версии](https://voyah.ru/news/voyah-obuyavlyaet-specifikacii-na-novyj-gibridnyj-sedan-s-uvelichennym-zapasom-hoda-voyah-passion-evr),
[Exlantix ES — BEV и REEV](https://exeed.kz/ru/news/131/),
[Stelato S9 — BEV и EREV](https://cnevpost.com/2025/11/20/stelato-launches-updated-s9-sedan/),
[BYD Han — электрический и гибридный](https://en.byd.com/news/byds-flagship-han-ev-series-officially-goes-on-sale/).
Также подтверждены гибридные версии [Denza D9](https://media.byd.com/denza-brings-super-hybrid-tech-to-mpv-segment-with-d9-dm-i/?lang=eng)
и [Voyah Dream](https://voyah.ru/media/download/docs/4vzwjh__rkovodstvo-pol-zovatela-voyah-dream.pdf).
Производитель подтверждает дизельную наряду с электрической версией
[Citroën SpaceTourer](https://www.media.stellantis.com/uk-en/citroen/press/citroen-broadens-powertrain-choice-on-spacetourer-berlingo-with-introduction-of-petrol-diesel-variants)
и дизельную наряду с электрической версией
[Opel Zafira](https://www.media.stellantis.com/em-en/opel/press/powerful-mpv-opel-zafira-with-newly-developed-2-2-litre-diesel).
Уточнение 2026-11-18: бензиновый вариант в сообщении Citroën относится к
Berlingo, а не SpaceTourer. Новый частичный обзор и пределы поколений/лет:
[readiness audit](VEHICLE_CLASSIFIER_READINESS_2026-11-18.md).
Конкретные поколения и годы модели из CSV нуждаются в отдельной проверке.
Строка модели без поля силовой установки не позволяет технически исключить
только BEV-версию. До внедрения потребуется подтверждать тип конкретного авто
и серверно применять запрет BEV; правило для этих моделей не удалялось.

## Проверка и пределы

После удаления: 121 approved: 76 Комфорт, 22 Бизнес, 23 Минивэн.
SHA256 CSV `553384af5b49252d3b3acbc3973ef6dae7fc40d348156debf4f0fab24c5ae880`.
Проверка: удалены только указанные 10 исходных строк, остальные 121 строка и
порядок побайтно по полям сохранены; архивный v1 не изменён. Проверка всех
оставшихся марок, поколений и версий на возможный BEV ещё не завершена, и
CSV без поля силовой установки не обеспечивает запрет BEV для смешанных моделей.
Runtime/модерация/живые автомобили не изменены, тестов реализации нет.

Документальные регрессии: `python tests/vehicleClassifierReference.test.py -v`
— 6 PASS. Проверены структура, 121 уникальная approved строка и распределение,
отсутствие 10 ранее подтверждённых BEV, наличие отдельных моделей со смешанными
версиями, два утверждённых Li Auto исключения, сохранение полей 112 оставшихся
строк исходного архива и условий оставшихся дополнений из утверждённого JSON.
Проверка не доказывает, что все BEV исполнения
обнаружены, и не заменяет будущую серверную проверку типа установки.
