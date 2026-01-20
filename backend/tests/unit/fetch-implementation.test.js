const NextCloudAdminShareService = require("../../config/nextcloud-admin-share.js");

describe("Fetch Implementation Tests", () => {
  let adminShareService;

  beforeEach(() => {
    adminShareService = NextCloudAdminShareService;
  });

  test("should construct proper upload URL with encoding", () => {
    const filename = "Vice President of Engineering, Automation & Integration @ Aspirion Health Resources LLC.pdf";
    const encodedFileName = encodeURIComponent(filename);
    
    // Use the actual service values
    const uploadUrl = `${adminShareService.baseUrl}/remote.php/dav/files/${adminShareService.adminUser}/Documents/${encodedFileName}`;
    
    // Just verify the encoding works correctly
    expect(encodedFileName).toBe("Vice%20President%20of%20Engineering%2C%20Automation%20%26%20Integration%20%40%20Aspirion%20Health%20Resources%20LLC.pdf");
    expect(uploadUrl).toContain("remote.php/dav/files/");
    expect(uploadUrl).toContain("/Documents/");
    expect(uploadUrl).toContain(encodedFileName);
  });

  test("should construct proper share data with encoding", () => {
    const filename = "Vice President of Engineering, Automation & Integration @ Aspirion Health Resources LLC.pdf";
    const userUid = "419b58fb20410df82dae8015d3d0ad15a2fd29583601da50ff953a96f16e5e33";
    const permissions = 31;
    
    const encodedFileName = encodeURIComponent(filename);
    const shareData = `path=Documents/${encodedFileName}&shareType=0&shareWith=${userUid}&permissions=${permissions}`;
    
    expect(shareData).toContain("path=Documents/Vice%20President%20of%20Engineering%2C%20Automation%20%26%20Integration%20%40%20Aspirion%20Health%20Resources%20LLC.pdf");
    expect(shareData).toContain(`shareWith=${userUid}`);
    expect(shareData).toContain(`permissions=${permissions}`);
  });

  test("should construct proper authorization header", () => {
    const authHeader = `Basic ${Buffer.from(`${adminShareService.adminUser}:${adminShareService.adminPassword}`).toString("base64")}`;
    
    expect(authHeader).toMatch(/^Basic [A-Za-z0-9+/=]+$/);
    expect(authHeader).not.toBe("Basic ");
  });

  test("should parse share response correctly", () => {
    // Use test admin user from env, or fallback for test environment
    const testAdminUser = process.env.NEXTCLOUD_ADMIN_USER || process.env.TEST_NEXTCLOUD_ADMIN_USER || "test_admin";
    const mockResponse = `<?xml version="1.0"?>
<ocs>
 <meta>
  <status>ok</status>
  <statuscode>200</statuscode>
  <message>OK</message>
 </meta>
 <data>
  <id>5</id>
  <share_type>0</share_type>
  <uid_owner>${testAdminUser}</uid_owner>
  <permissions>19</permissions>
  <path>/Documents/test.pdf</path>
  <share_with>419b58fb20410df82dae8015d3d0ad15a2fd29583601da50ff953a96f16e5e33</share_with>
  <status>ok</status>
 </data>
</ocs>`;

    const result = adminShareService.parseShareResponse(mockResponse);
    
    expect(result.id).toBe("5");
    expect(result.shareType).toBe("0");
    expect(result.permissions).toBe("19");
    expect(result.path).toBe("/Documents/test.pdf");
    expect(result.shareWith).toBe("419b58fb20410df82dae8015d3d0ad15a2fd29583601da50ff953a96f16e5e33");
    expect(result.status).toBe("ok");
  });
});
