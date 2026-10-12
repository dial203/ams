import { useLocalSearchParams } from "expo-router";
import { QuestionnaireScreen } from "../../src/screens/QuestionnaireScreen";

export default function FormRoute() {
  const { formId } = useLocalSearchParams<{ formId: string }>();
  return <QuestionnaireScreen formId={String(formId)} />;
}
