# Read the contents of a PDF or image file and determine its document type.

Analyze the following file and return JSON only.

Additional keys may be included as needed. Do not output any explanatory text outside of the JSON.

## Reading the image

Read the information typically added to FAX headers and footers into the `fax_properties` fields.
Respond with the classification result using the following sample JSON format.

```json
{
    "documentClassId": "DocumentClassID", // DocumentClassID determined from the document content
    "confidence": 0.5, // Confidence level of the classification, expressed as a value between 0 and 1.0
    "fax_properties": { // FAX transmission information read from the outermost header/footer of the page
        "senderName": "Sender name",
        "senderFaxNumber": "Sender fax number",
        "recipientName": "Recipient name",
        "recipientFaxNumber": "Recipient fax number",
        "transmissionTimestamp": "2021-01-01T12:12:12",
        "totalPages": 3,
        "jobId": "abcd" // Job ID
    },
    "content_properties": {
        // Fields to be read from the document body, common to all document types
        "title": "Title", // A title representing the content of the document
        "senderName": "XX Trading Co.", // Sender/author name as written in the document body
        "senderFaxNumber": "000-1234-1234", // Sender's fax number as written in the document body
        "senderPhoneNumber": "000-1234-1234", // Sender's phone number as written in the document body
        "recipientName": "AA Corporation", // Recipient name as written in the document body
        "recipientFaxNumber": "090-1234-1234", // Recipient's fax number as written in the document body
        "recipientPhoneNumber": "000-1234-1234", // Recipient's phone number as written in the document body
        "timestamp": "2021-01-01T12:12:12" // Representative date/time of the document (ISO format)
    },
    "typed_properties": {
        // Individual extracted fields as instructed per DocumentClassID
        // Store the extracted items here
    },
    // Additional per-DocumentClassID properties and object definitions are appended here.
    "notes": "" // additional extra remarks if needed.
}
```

## Classification Condition List

The following lists:

- Conditions for determining the DocumentType
- Additional fields to be extracted upon a successful match

Use the first entry that matches with high confidence as the DocumentClass for this document, and construct the returned JSON accordingly.
If none of the types match, set `"documentClassId": null`.

`-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=ypl` is the delimiter that defines each DocumentType. Each subsection defines the DocumentClass name, its matching conditions, and the list of fields to extract.


