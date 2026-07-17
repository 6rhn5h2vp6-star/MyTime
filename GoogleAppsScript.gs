function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = JSON.parse(e.postData.contents);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "受信日時","日付","氏名","出社","退社","実働分",
      "配送設置件数","GPS","日報","業務詳細JSON"
    ]);
  }

  const formatTime = (ms) => {
    if (!ms) return "";
    return Utilities.formatDate(new Date(ms), "Asia/Tokyo", "HH:mm");
  };

  sheet.appendRow([
    new Date(),
    data.date || "",
    data.name || "",
    formatTime(data.clockIn),
    formatTime(data.clockOut),
    data.workMinutes || 0,
    data.totalJobs || 0,
    data.gps ? `${data.gps.lat},${data.gps.lng}` : "",
    data.report || "",
    JSON.stringify(data.jobs || [])
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ok:true}))
    .setMimeType(ContentService.MimeType.JSON);
}