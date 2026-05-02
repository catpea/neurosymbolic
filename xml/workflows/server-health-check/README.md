# Server Health Check

**Type:** workflow  
**Name:** `server-health-check`

---

```xml
<Workflow name="server-health-check" title="Server Health Check" category="system">
  <Variables>
    <Variable name="url" value="http://localhost:11222/health" />
    <Variable name="path" value="status" />
    <Variable name="expected" value="ok" />
  </Variables>
  <Action use="cls" />
  <Action use="http" url="$url" expectJsonPath="$path" expectJsonValue="$expected" />
  <Action use="goto" to="/application/shell" text="Continue to Shell" color="primary" />
</Workflow>
```
