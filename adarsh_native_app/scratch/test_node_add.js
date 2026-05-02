const fs = require('fs');

async function testMobileAdd() {
  const url = 'http://127.0.0.1:8000/app/api/table/1/card/add/';
  
  // Create form data just like React Native FormData
  // For a node script, we'll just send JSON to bypass FormData complexity for simple text fields
  // Wait, the mobile app sends FormData even for text fields.
  // Actually, the backend allows URL-encoded or multipart or just JSON in `field_data` field in POST body.
  
  const fieldData = {
    "STUDENT NAME": "NODE MOBILE ADD",
    "CLASS": "12th"
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Adarsh App',
      'Cookie': 'sessionid=dxukw461pzb4wne4jjgisl69zzhpvhyc'
    },
    body: `field_data=${encodeURIComponent(JSON.stringify(fieldData))}`
  });

  const text = await response.text();
  console.log('Status:', response.status);
  console.log('Response:', text);
}

testMobileAdd();
