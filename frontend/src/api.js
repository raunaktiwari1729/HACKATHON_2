import axios from 'axios';

// i put every single backend call here so if the base url ever changes, i only update one line
// never write axios.post(...) directly inside a component — always go through this file
const BASE_URL = process.env.REACT_APP_API_URL || 'https://hackathon-2-dgif.onrender.com';

// 60s timeout because the llm can take 20-30s on its first call
const client = axios.create({
  baseURL: BASE_URL,
  timeout: 60000,
});

// upload a pdf — backend runs pdf → llm → save and returns the new case_id
// { case_id, case_number, case_title, total_pages, has_ocr, message }
export async function uploadJudgment(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await client.post('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
}

// lightweight list for the review queue sidebar — no source sentences, just the basics
export async function getPendingCases() {
  const res = await client.get('/pending');
  return res.data;
}

// full case data with source sentences + page refs — only called when reviewer opens a case
export async function getCase(caseId) {
  const res = await client.get(`/case/${caseId}`);
  return res.data;
}

// reviewer is happy — move this case to the dashboard
// edits[] logs what they changed, updatedPlan is the corrected action plan if anything changed
export async function approveCase(caseId, reviewedBy, notes = null, edits = [], updatedPlan = null) {
  const res = await client.post(`/approve/${caseId}`, {
    reviewed_by:  reviewedBy,
    notes,
    edits,
    updated_plan: updatedPlan,
  });
  return res.data;
}

// reviewer rejected it — bad pdf, wrong doc, completely wrong extraction
// case stays in db but never appears anywhere in the ui
export async function rejectCase(caseId, reviewedBy, notes = null) {
  const res = await client.post(`/reject/${caseId}`, {
    reviewed_by: reviewedBy,
    notes,
  });
  return res.data;
}

// approved cases for the dashboard, ordered by deadline asc (most urgent first)
// pass a department string to filter — used by the dropdown
export async function getDashboardCases(department = null) {
  const params = department ? { department } : {};
  const res = await client.get('/dashboard', { params });
  return res.data; // { total, cases: [...] }
}

// unique department names for the filter dropdown in dashboard
export async function getDepartments() {
  const res = await client.get('/departments');
  return res.data.departments;
}

export async function checkHealth() {
  const res = await client.get('/health');
  return res.data;
}

export default {
  uploadJudgment,
  getPendingCases,
  getCase,
  approveCase,
  rejectCase,
  getDashboardCases,
  getDepartments,
  checkHealth,
};
