export const getCourseColorClass = (courseCode) => {
  if (!courseCode) return 'course-bg-0';
  
  // Use a simple hash to assign a consistent color
  let hash = 0;
  for (let i = 0; i < courseCode.length; i++) {
    hash = courseCode.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  const colorIndex = Math.abs(hash) % 5 + 1; // 1 to 5
  return `course-bg-${colorIndex}`;
};
