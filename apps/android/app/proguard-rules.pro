# Firestore documents are read by hand (data/Documents.kt), never by
# reflection, so nothing here needs keeping. Navigation keys are serialized
# with kotlinx.serialization, whose generated serializers survive R8.
