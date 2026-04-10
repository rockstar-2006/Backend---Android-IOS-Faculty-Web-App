const XLSX = require('xlsx');

class ExcelService {
  generateQuizResultsExcel(quizTitle, attempts) {
    // Create worksheet data
    const wsData = [
      ['Quiz Results Report'],
      ['Quiz Title:', quizTitle],
      ['Generated on:', new Date().toLocaleString()],
      ['Total Students:', attempts.length],
      [],
      ['Name', 'USN', 'Email', 'Branch', 'Year', 'Semester', 'Total Marks', 'Max Marks', 'Percentage (%)', 'Status', 'Violation Reason', 'Submitted At']
    ];

    // Add student data
    attempts.forEach(attempt => {
      wsData.push([
        attempt.studentName || 'N/A',
        attempt.studentUSN || 'N/A',
        attempt.studentEmail || 'N/A',
        attempt.studentBranch || 'N/A',
        attempt.studentYear || 'N/A',
        attempt.studentSemester || 'N/A',
        attempt.totalMarks || 0,
        attempt.maxMarks || 0,
        attempt.percentage || 0,
        attempt.status || 'N/A',
        attempt.violationReason || '',
        attempt.submittedAt ? new Date(attempt.submittedAt).toLocaleString() : 'Not submitted'
      ]);
    });

    // Calculate statistics
    if (attempts.length > 0) {
      const validTotalMarks = attempts.map(a => a.totalMarks || 0);
      const validPercentages = attempts.map(a => a.percentage || 0);

      const avgMarks = validTotalMarks.reduce((sum, val) => sum + val, 0) / attempts.length;
      const avgPercentage = validPercentages.reduce((sum, val) => sum + val, 0) / attempts.length;
      const maxScore = Math.max(...validTotalMarks);
      const minScore = Math.min(...validTotalMarks);

      wsData.push([]);
      wsData.push(['Statistics']);
      wsData.push(['Average Marks:', avgMarks.toFixed(2)]);
      wsData.push(['Average Percentage:', avgPercentage.toFixed(2) + '%']);
      wsData.push(['Highest Score:', maxScore]);
      wsData.push(['Lowest Score:', minScore]);
      wsData.push(['Pass Rate (>40%):', attempts.filter(a => (a.percentage || 0) >= 40).length + '/' + attempts.length]);
    }

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Set column widths
    ws['!cols'] = [
      { wch: 20 }, // Name
      { wch: 15 }, // USN
      { wch: 25 }, // Email
      { wch: 15 }, // Branch
      { wch: 10 }, // Year
      { wch: 10 }, // Semester
      { wch: 12 }, // Total Marks
      { wch: 12 }, // Max Marks
      { wch: 15 }, // Percentage
      { wch: 12 }, // Status
      { wch: 20 }  // Submitted At
    ];

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, 'Results');

    // Generate buffer
    const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return excelBuffer;
  }

  generateDetailedQuizResultsExcel(quizTitle, quiz, attempts) {
    const wb = XLSX.utils.book_new();

    // Summary Sheet
    const summaryData = [
      ['Quiz Results - Detailed Report'],
      ['Quiz Title:', quizTitle || 'Untitled Quiz'],
      ['Generated on:', new Date().toLocaleString()],
      ['Total Questions:', quiz?.questions?.length || 0],
      ['Total Students:', attempts.length],
      [],
      ['Name', 'USN', 'Email', 'Branch', 'Year', 'Semester', 'Total Marks', 'Max Marks', 'Percentage (%)', 'Status', 'Violation Reason']
    ];

    attempts.forEach(attempt => {
      summaryData.push([
        attempt.studentName || 'N/A',
        attempt.studentUSN || 'N/A',
        attempt.studentEmail || 'N/A',
        attempt.studentBranch || 'N/A',
        attempt.studentYear || 'N/A',
        attempt.studentSemester || 'N/A',
        attempt.totalMarks || 0,
        attempt.maxMarks || 0,
        attempt.percentage || 0,
        attempt.status || 'N/A',
        attempt.violationReason || ''
      ]);
    });

    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    wsSummary['!cols'] = [
      { wch: 20 }, { wch: 15 }, { wch: 25 }, { wch: 15 },
      { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 },
      { wch: 15 }, { wch: 12 }
    ];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

    // Individual student sheets (limit to first 20 for performance)
    attempts.slice(0, 20).forEach((attempt, index) => {
      const studentData = [
        ['Student Details'],
        ['Name:', attempt.studentName || 'N/A'],
        ['USN:', attempt.studentUSN || 'N/A'],
        ['Email:', attempt.studentEmail || 'N/A'],
        ['Branch:', attempt.studentBranch || 'N/A'],
        ['Year:', attempt.studentYear || 'N/A'],
        ['Semester:', attempt.studentSemester || 'N/A'],
        [],
        ['Score:', `${attempt.totalMarks || 0}/${attempt.maxMarks || 0} (${attempt.percentage || 0}%)`],
        ['Violation Reason:', attempt.violationReason || 'None'],
        [],
        ['Question', 'Type', 'Student Answer', 'Correct Answer', 'Result', 'Marks']
      ];

      if (Array.isArray(attempt.answers)) {
        attempt.answers.forEach((ans, qNum) => {
          studentData.push([
            `Q${qNum + 1}: ${ans.question || 'N/A'}`,
            ans.type || 'N/A',
            ans.studentAnswer || 'Not answered',
            ans.correctAnswer || 'N/A',
            ans.isCorrect ? 'Correct' : 'Incorrect',
            ans.marks || 0
          ]);
        });
      }

      const wsStudent = XLSX.utils.aoa_to_sheet(studentData);
      wsStudent['!cols'] = [
        { wch: 50 }, { wch: 15 }, { wch: 30 },
        { wch: 30 }, { wch: 12 }, { wch: 10 }
      ];

      const sheetName = `${attempt.studentUSN || 'Student_' + index}`.substring(0, 31); // Excel sheet name limit
      XLSX.utils.book_append_sheet(wb, wsStudent, sheetName);
    });

    const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return excelBuffer;
  }
}

module.exports = new ExcelService();
