import React from 'react';
import { View } from 'react-native';

// Simple HStack / VStack helpers that add consistent spacing between children.
// They clone children and inject margin styles so we avoid using unsupported `gap`.
export function HStack({ children, spacing = 8, style, align = 'center', justify = 'flex-start', ...rest }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[{ flexDirection: 'row', alignItems: align, justifyContent: justify }, style]} {...rest}>
      {items.map((child, i) => {
        const isLast = i === items.length - 1;
        const childStyle = { marginRight: isLast ? 0 : spacing };
        return React.cloneElement(child, { style: [child.props.style, childStyle] });
      })}
    </View>
  );
}

export function VStack({ children, spacing = 8, style, align = 'stretch', justify = 'flex-start', ...rest }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[{ flexDirection: 'column', alignItems: align, justifyContent: justify }, style]} {...rest}>
      {items.map((child, i) => {
        const isLast = i === items.length - 1;
        const childStyle = { marginBottom: isLast ? 0 : spacing };
        return React.cloneElement(child, { style: [child.props.style, childStyle] });
      })}
    </View>
  );
}

export default HStack;

// Wrap helper: applies uniform right & bottom spacing to children to emulate CSS gap with wrapping.
export function Wrap({ children, spacing = 8, style, align = 'flex-start', justify = 'flex-start', ...rest }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', alignItems: align, justifyContent: justify }, style]} {...rest}>
      {items.map((child, i) => {
        const isLast = i === items.length - 1;
        const childStyle = { marginRight: isLast ? 0 : spacing, marginBottom: spacing };
        return React.cloneElement(child, { style: [child.props.style, childStyle] });
      })}
    </View>
  );
}
