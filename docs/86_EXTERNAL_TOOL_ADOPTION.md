# External Tool Adoption

## OpenCodeReview

OpenCodeReview is installed locally as `ocr` (version verified by `ocr --version`).

Use it after reviewing a change locally:

```powershell
cd C:\Users\tianj\Desktop\越南工厂瑞晶\smt-factory-system
ocr delegate preview
```

The initial integration uses delegation mode. This keeps factory source inside the configured coding-agent boundary and does not require or create an external LLM API key.

Before enabling `ocr review`, CI review, or a provider-backed scan, the project owner must approve:

1. The provider and model.
2. Whether source code may be transmitted to that provider.
3. The API credential storage and access scope.

## Microsoft AI for Beginners

The HR Training screen contains a source-linked, attributed 12-week AI learning path based on Microsoft AI for Beginners. It has no automatic enrollments, assessments, or employee record writes.

Source: <https://github.com/microsoft/AI-For-Beginners> (MIT License).

## Pascal 3D Editor

Pascal Editor remains an evaluation candidate for the next 3D factory-navigation phase. Do not add its packages to the production web application until a pilot defines the scene data model, browser/device support, WebGPU fallback, performance budget, and operator workflow.

Reference: <https://github.com/pascalorg/editor>.
