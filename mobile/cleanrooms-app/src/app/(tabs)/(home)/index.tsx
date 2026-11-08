import { EmployeeSection } from '@/components/employee-section';
import HomeScreen from '@/screens/home-screen';

export default function HomeRoute() {
  return <EmployeeSection section="overview"><HomeScreen /></EmployeeSection>;
}
