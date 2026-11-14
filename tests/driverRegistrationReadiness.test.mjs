import assert from "node:assert/strict";

import {
  evaluateDriverRegistrationReadiness
} from "../src/core/driverPrivateUploadService.js";


const DRIVER_DOCUMENTS = [
  "passport_main",
  "passport_registration",
  "passport_selfie",
  "identity_reference_selfie",
  "driver_license_front",
  "driver_license_back"
];

const VEHICLE_PHOTOS = [
  "left",
  "front",
  "right",
  "rear",
  "open_trunk",
  "rear_cabin",
  "front_cabin"
];


function driverDocument(
  kind,
  status = "pending"
) {
  return {
    id:
      "doc_" + kind,

    vehicleId:
      null,

    kind,

    status
  };
}


function vehicleDocument(
  vehicleId,
  kind,
  status = "pending"
) {
  return {
    id:
      "doc_" +
      vehicleId +
      "_" +
      kind,

    vehicleId,

    kind,

    status
  };
}


function vehiclePhoto(
  vehicleId,
  kind,
  status = "pending"
) {
  return {
    id:
      "photo_" +
      vehicleId +
      "_" +
      kind,

    vehicleId,

    kind,

    status
  };
}


const profile = {
  fullName:
    "Иван Иванов",

  birthDate:
    "1990-05-20",

  region:
    "Нижегородская область"
};


const ownerVehicle = {
  id:
    "vehicle_owner",

  usageBasis:
    "owner"
};


const baseMaterials = {
  documents: [
    ...DRIVER_DOCUMENTS.map(
      kind =>
        driverDocument(
          kind
        )
    ),
    vehicleDocument(
      ownerVehicle.id,
      "sts_front"
    ),
    vehicleDocument(
      ownerVehicle.id,
      "sts_back"
    )
  ],

  photos:
    VEHICLE_PHOTOS.map(
      kind =>
        vehiclePhoto(
          ownerVehicle.id,
          kind
        )
    )
};


const ready =
  evaluateDriverRegistrationReadiness(
    profile,
    [
      ownerVehicle
    ],
    baseMaterials
  );


assert.equal(
  ready.complete,
  true
);

assert.deepEqual(
  ready.completeVehicleIds,
  [
    ownerVehicle.id
  ]
);


const incompleteSecondVehicle = {
  id:
    "vehicle_second",

  usageBasis:
    "owner"
};


const withIncompleteSecond =
  evaluateDriverRegistrationReadiness(
    profile,
    [
      ownerVehicle,
      incompleteSecondVehicle
    ],
    baseMaterials
  );


assert.equal(
  withIncompleteSecond.complete,
  true,
  "an incomplete extra vehicle must not block a complete registration"
);

assert.deepEqual(
  withIncompleteSecond.completeVehicleIds,
  [
    ownerVehicle.id
  ]
);


const rentalVehicle = {
  id:
    "vehicle_rental",

  usageBasis:
    "rental"
};


const rentalMaterialsWithoutContract = {
  documents: [
    ...DRIVER_DOCUMENTS.map(
      kind =>
        driverDocument(
          kind
        )
    ),
    vehicleDocument(
      rentalVehicle.id,
      "sts_front"
    ),
    vehicleDocument(
      rentalVehicle.id,
      "sts_back"
    )
  ],

  photos:
    VEHICLE_PHOTOS.map(
      kind =>
        vehiclePhoto(
          rentalVehicle.id,
          kind
        )
    )
};


const rentalMissing =
  evaluateDriverRegistrationReadiness(
    profile,
    [
      rentalVehicle
    ],
    rentalMaterialsWithoutContract
  );


assert.equal(
  rentalMissing.complete,
  false
);

assert.deepEqual(
  rentalMissing.vehicles[0]
    .missingDocuments,
  [
    "rental_contract"
  ]
);


const rentalReady =
  evaluateDriverRegistrationReadiness(
    profile,
    [
      rentalVehicle
    ],
    {
      ...rentalMaterialsWithoutContract,

      documents: [
        ...rentalMaterialsWithoutContract
          .documents,

        vehicleDocument(
          rentalVehicle.id,
          "rental_contract"
        )
      ]
    }
  );


assert.equal(
  rentalReady.complete,
  true
);


const missingRearPhoto =
  evaluateDriverRegistrationReadiness(
    profile,
    [
      ownerVehicle
    ],
    {
      ...baseMaterials,

      photos:
        baseMaterials.photos
          .filter(
            item =>
              item.kind !==
                "rear"
          )
    }
  );


assert.equal(
  missingRearPhoto.complete,
  false
);

assert.deepEqual(
  missingRearPhoto
    .vehicles[0]
    .missingPhotos,
  [
    "rear"
  ]
);


const rejectedPassport =
  evaluateDriverRegistrationReadiness(
    profile,
    [
      ownerVehicle
    ],
    {
      ...baseMaterials,

      documents:
        baseMaterials.documents
          .map(
            item =>
              item.kind ===
                "passport_main"
              &&
              item.vehicleId ===
                null
                ? {
                    ...item,
                    status:
                      "changes_required"
                  }
                : item
          )
    }
  );


assert.equal(
  rejectedPassport.complete,
  false
);

assert.deepEqual(
  rejectedPassport
    .missingDriverDocuments,
  [
    "passport_main"
  ]
);


console.log(
  "✓ DRIVER REGISTRATION READINESS TESTS PASSED"
);
