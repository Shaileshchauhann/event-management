import 'package:flutter_test/flutter_test.dart';
import 'package:gate_app/main.dart';

void main() {
  testWidgets('shows gate scanner heading', (tester) async {
    await tester.pumpWidget(const GateApp());
    expect(find.text('GATE KEEPER'), findsOneWidget);
    expect(find.text('Scan ticket QR'), findsOneWidget);
  });
}
