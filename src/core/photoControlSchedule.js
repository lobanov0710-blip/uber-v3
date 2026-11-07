// =========================================
// PHOTO CONTROL SCHEDULE
// =========================================

export const PHOTO_CONTROL_GRACE_MS =
  24 * 60 * 60 * 1000;


function requireTimestamp(
  value
) {
  const timestamp =
    Number(value);

  if (
    !Number.isSafeInteger(
      timestamp
    ) ||
    timestamp <= 0
  ) {
    throw new Error(
      "invalid photo control timestamp"
    );
  }

  return timestamp;
}


export function addOneCalendarMonthUtc(
  value
) {
  const timestamp =
    requireTimestamp(
      value
    );

  const source =
    new Date(
      timestamp
    );


  if (
    Number.isNaN(
      source.getTime()
    )
  ) {
    throw new Error(
      "invalid photo control date"
    );
  }


  const year =
    source.getUTCFullYear();

  const month =
    source.getUTCMonth();

  const day =
    source.getUTCDate();

  const hour =
    source.getUTCHours();

  const minute =
    source.getUTCMinutes();

  const second =
    source.getUTCSeconds();

  const millisecond =
    source.getUTCMilliseconds();


  const targetMonthStart =
    new Date(
      Date.UTC(
        year,
        month + 1,
        1,
        hour,
        minute,
        second,
        millisecond
      )
    );


  const nextMonthStart =
    new Date(
      Date.UTC(
        targetMonthStart
          .getUTCFullYear(),
        targetMonthStart
          .getUTCMonth() + 1,
        1,
        hour,
        minute,
        second,
        millisecond
      )
    );


  const lastTargetDay =
    new Date(
      nextMonthStart.getTime() -
      24 * 60 * 60 * 1000
    )
      .getUTCDate();


  const targetDay =
    Math.min(
      day,
      lastTargetDay
    );


  const target =
    Date.UTC(
      targetMonthStart
        .getUTCFullYear(),
      targetMonthStart
        .getUTCMonth(),
      targetDay,
      hour,
      minute,
      second,
      millisecond
    );


  if (
    !Number.isSafeInteger(
      target
    ) ||
    target <= timestamp
  ) {
    throw new Error(
      "invalid next photo control due date"
    );
  }


  return target;
}
