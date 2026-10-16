import { ToastProvider } from './ui/common/Toast';
import { Home } from './ui/Home';
import { AuthorWorkspace } from './ui/author/AuthorWorkspace';
import { StudentWorkspace } from './ui/student/StudentWorkspace';
import { ResultsScreen } from './ui/results/ResultsScreen';
import { useRoute } from './ui/router';

export default function App() {
  const route = useRoute();
  let view;
  switch (route.view) {
    case 'home':
      view = <Home />;
      break;
    case 'author':
      view = <AuthorWorkspace key={route.examId} examId={route.examId} />;
      break;
    case 'student':
      view = <StudentWorkspace key={route.examId} examId={route.examId} />;
      break;
    case 'results':
      view = <ResultsScreen key={route.attemptId} examId={route.examId} attemptId={route.attemptId} />;
      break;
  }
  return (
    <ToastProvider>
      <div className="app">{view}</div>
    </ToastProvider>
  );
}
