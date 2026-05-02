# HTTP Request

**Type:** command  
**Name:** `http`

**Synopsis:** `http url="https://example.com" expectStatus="200"`

Fetches a URL and validates status, body text, or JSON path.

---

```xml
<Command name="http" path="/cmd/network/http" title="HTTP Request" category="network">
  <Synopsis>http url="https://example.com" expectStatus="200"</Synopsis>
  <Description>Fetches a URL and validates status, body text, or JSON path.</Description>
  <Parameters>
    <Parameter name="url" type="text/plain" required="true"/>
    <Parameter name="expectStatus" type="text/plain" required="false"/>
    <Parameter name="expectContains" type="text/plain" required="false"/>
    <Parameter name="expectJsonPath" type="text/plain" required="false"/>
    <Parameter name="expectJsonValue" type="text/plain" required="false"/>
  </Parameters>
  <Output type="component" component="alert"/>
  <Improve>Add timeout support and support for POST/PUT methods.</Improve>
  <Function src="src/index.js"/>
</Command>
```
